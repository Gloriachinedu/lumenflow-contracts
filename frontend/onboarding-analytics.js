/**
 * onboarding-analytics.js
 *
 * Client-side funnel instrumentation for the merchant onboarding wizard
 * (`frontend/onboarding.html`). Defines the canonical set of onboarding funnel
 * events, validates every payload against a schema, strips personally
 * identifiable information (PII) before dispatch, and forwards accepted events
 * to a pluggable sink.
 *
 * Design goals:
 *   - No backend or build step required — runs entirely in the browser.
 *   - Safe by default: if no sink is configured the module is a silent no-op.
 *   - Never throws into caller code — a bad event is dropped and counted.
 *   - Privacy first: wallet addresses, emails and free-text business fields
 *     are never emitted. Only coarse, non-identifying funnel signals leave
 *     the page.
 *
 * See docs/merchant-onboarding-metrics.md for the funnel model, the event
 * catalogue and the metric definitions these events feed.
 */

(function (global) {
  'use strict';

  var SCHEMA_VERSION = 1;

  // Ordered funnel stages. Index === wizard step number.
  var FUNNEL_STAGES = [
    null,
    'welcome',       // step 1
    'wallet',        // step 2
    'business_details', // step 3
    'review',        // step 4
    'done',          // step 5
  ];

  // Canonical event catalogue. `props` lists the ADDITIONAL property names an
  // event may carry beyond the common envelope. Anything not listed is dropped.
  var EVENTS = {
    onboarding_started:            { props: [] },
    onboarding_step_viewed:        { props: ['step', 'stage'] },
    onboarding_step_completed:     { props: ['step', 'stage'] },
    onboarding_step_back:          { props: ['from_step', 'to_step'] },
    wallet_connect_attempted:      { props: ['provider'] },
    wallet_connected:              { props: ['provider', 'is_demo'] },
    wallet_connect_failed:         { props: ['provider', 'reason'] },
    business_details_validation_failed: { props: ['fields'] },
    merchant_registration_submitted:    { props: ['is_demo'] },
    merchant_registration_succeeded:    { props: ['is_demo', 'duration_ms'] },
    merchant_registration_failed:       { props: ['is_demo', 'reason'] },
    onboarding_completed:          { props: ['duration_ms', 'is_demo'] },
    onboarding_abandoned:          { props: ['step', 'stage'] },
  };

  // Property allow-list values. Free-form strings are length-clamped; enum-like
  // properties are validated against these sets.
  var PROVIDERS = ['freighter', 'albedo', 'demo'];
  var VALIDATION_FIELDS = ['name', 'description', 'email', 'category'];
  var MAX_REASON_LEN = 64;

  // Keys that must never appear in a payload, regardless of event.
  var PII_DENYLIST = [
    'address', 'walletaddress', 'wallet_address', 'publickey', 'public_key',
    'email', 'name', 'business_name', 'description', 'memo', 'contact',
  ];

  var state = {
    sink: null,
    funnelId: null,
    startedAt: null,
    dropped: 0,
    lastStage: null,
  };

  function now() {
    return (global.performance && global.performance.now)
      ? Math.round(global.performance.now())
      : Date.now();
  }

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) {
      try { return global.crypto.randomUUID(); } catch (e) { /* fall through */ }
    }
    return 'fnl-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 10);
  }

  function getFunnelId() {
    if (state.funnelId) return state.funnelId;
    var key = 'lf_onboarding_funnel_id';
    var stored = null;
    try { stored = global.sessionStorage.getItem(key); } catch (e) { /* ignore */ }
    if (!stored) {
      stored = uuid();
      try { global.sessionStorage.setItem(key, stored); } catch (e) { /* ignore */ }
    }
    state.funnelId = stored;
    return stored;
  }

  function clampString(value, max) {
    var s = String(value == null ? '' : value);
    return s.length > max ? s.slice(0, max) : s;
  }

  function isDenied(key) {
    var k = String(key).toLowerCase();
    for (var i = 0; i < PII_DENYLIST.length; i++) {
      if (k === PII_DENYLIST[i] || k.indexOf(PII_DENYLIST[i]) !== -1) return true;
    }
    return false;
  }

  /**
   * Validate + normalise a single event property. Returns `undefined` when the
   * property should be dropped.
   */
  function sanitizeProp(name, value) {
    if (isDenied(name)) return undefined;

    switch (name) {
      case 'step':
      case 'from_step':
      case 'to_step': {
        var n = parseInt(value, 10);
        return (n >= 1 && n <= 5) ? n : undefined;
      }
      case 'stage':
        return FUNNEL_STAGES.indexOf(value) > 0 ? value : undefined;
      case 'provider':
        return PROVIDERS.indexOf(value) !== -1 ? value : undefined;
      case 'is_demo':
        return Boolean(value);
      case 'duration_ms': {
        var d = Number(value);
        return (isFinite(d) && d >= 0) ? Math.round(d) : undefined;
      }
      case 'reason':
        return clampString(value, MAX_REASON_LEN);
      case 'fields': {
        if (!Array.isArray(value)) return undefined;
        var out = value.filter(function (f) {
          return VALIDATION_FIELDS.indexOf(f) !== -1;
        });
        return out.length ? out : undefined;
      }
      default:
        return undefined;
    }
  }

  /**
   * Build a fully-formed, PII-free event envelope. Returns `null` for an
   * unknown event name or when required context is missing.
   */
  function build(eventName, props) {
    var spec = EVENTS[eventName];
    if (!spec) return null;

    var payload = {};
    var src = props || {};
    for (var i = 0; i < spec.props.length; i++) {
      var key = spec.props[i];
      if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
      var clean = sanitizeProp(key, src[key]);
      if (clean !== undefined) payload[key] = clean;
    }

    return {
      schema_version: SCHEMA_VERSION,
      event: eventName,
      funnel_id: getFunnelId(),
      // Whole seconds since funnel start — coarse by design.
      t_since_start_s: state.startedAt == null
        ? 0
        : Math.round((now() - state.startedAt) / 1000),
      ts: new Date().toISOString(),
      props: payload,
    };
  }

  var Analytics = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    FUNNEL_STAGES: FUNNEL_STAGES.slice(),
    EVENT_NAMES: Object.keys(EVENTS),

    /**
     * Register the event sink. `fn(event)` receives a validated envelope.
     * Passing a non-function disables dispatch (module becomes a no-op).
     */
    configure: function (fn) {
      state.sink = (typeof fn === 'function') ? fn : null;
      return this;
    },

    /** Marks funnel start and emits `onboarding_started` exactly once. */
    start: function () {
      if (state.startedAt != null) return this;
      state.startedAt = now();
      this.track('onboarding_started');
      return this;
    },

    /** Number of events rejected by validation this session. */
    droppedCount: function () { return state.dropped; },

    /**
     * Validate and dispatch an event. Unknown names / invalid payloads are
     * dropped (and counted); never throws.
     */
    track: function (eventName, props) {
      var envelope;
      try {
        envelope = build(eventName, props);
      } catch (e) {
        envelope = null;
      }
      if (!envelope) {
        state.dropped++;
        return false;
      }
      if (state.sink) {
        try {
          state.sink(envelope);
        } catch (e) {
          // A broken sink must not break onboarding.
          if (global.console && console.warn) {
            console.warn('[onboarding-analytics] sink threw:', e);
          }
        }
      }
      return true;
    },

    /** Convenience helper for the common step-view signal. */
    stepViewed: function (step) {
      var stage = FUNNEL_STAGES[step];
      if (stage && stage !== state.lastStage) {
        state.lastStage = stage;
        this.track('onboarding_step_viewed', { step: step, stage: stage });
      }
    },

    /** Convenience helper for the common step-complete signal. */
    stepCompleted: function (step) {
      this.track('onboarding_step_completed', {
        step: step, stage: FUNNEL_STAGES[step],
      });
    },

    /** Elapsed ms since `start()` — used for duration props. */
    elapsedMs: function () {
      return state.startedAt == null ? 0 : now() - state.startedAt;
    },
  };

  // UMD-ish export: browser global + CommonJS for unit testing.
  global.OnboardingAnalytics = Analytics;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Analytics;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

'use strict';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { Resource } = require('@opentelemetry/resources');
const {
  SemanticResourceAttributes,
} = require('@opentelemetry/semantic-conventions');

const DEFAULT_SERVICE_NAME = 'lumenflow-webhook';

let sdk = null;
let started = false;

/**
 * Resolve the service name from the environment.
 * @returns {string}
 */
function getServiceName() {
  return process.env.OTEL_SERVICE_NAME || DEFAULT_SERVICE_NAME;
}

/**
 * Determine whether the Jaeger exporter should be used.
 * Jaeger is used when OTEL_JAEGER_ENDPOINT is set or when running locally.
 * @returns {boolean}
 */
function shouldUseJaeger() {
  if (process.env.OTEL_JAEGER_ENDPOINT) {
    return true;
  }
  const env = (process.env.NODE_ENV || '').toLowerCase();
  return env === 'local' || env === 'development';
}

/**
 * Build the trace exporter based on environment configuration.
 * @returns {import('@opentelemetry/sdk-trace-base').SpanExporter}
 */
function buildExporter() {
  if (shouldUseJaeger()) {
    const endpoint =
      process.env.OTEL_JAEGER_ENDPOINT || 'http://localhost:14268/api/traces';
    return new JaegerExporter({ endpoint });
  }

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
  return new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
  });
}

/**
 * Build the resource describing this service.
 * @returns {Resource}
 */
function buildResource() {
  return new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: getServiceName(),
  });
}

/**
 * Build the instrumentation set for the webhook server.
 * @returns {Array}
 */
function buildInstrumentations() {
  return [
    ...getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ];
}

/**
 * Initialize and start the OpenTelemetry SDK.
 * Safe to call multiple times; subsequent calls are no-ops.
 * @returns {NodeSDK|null}
 */
function startTracing() {
  if (started) {
    return sdk;
  }

  try {
    sdk = new NodeSDK({
      resource: buildResource(),
      traceExporter: buildExporter(),
      instrumentations: buildInstrumentations(),
    });

    sdk.start();
    started = true;

    process.on('SIGTERM', () => {
      shutdownTracing().catch(() => {});
    });
  } catch (err) {
    // Tracing must never take down the service.
    // eslint-disable-next-line no-console
    console.error('[tracing] failed to start OpenTelemetry SDK:', err);
    sdk = null;
    started = false;
  }

  return sdk;
}

/**
 * Shut down the OpenTelemetry SDK, flushing any pending spans.
 * @returns {Promise<void>}
 */
async function shutdownTracing() {
  if (!sdk || !started) {
    return;
  }

  try {
    await sdk.shutdown();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[tracing] failed to shut down OpenTelemetry SDK:', err);
  } finally {
    sdk = null;
    started = false;
  }
}

module.exports = {
  startTracing,
  shutdownTracing,
  getServiceName,
};
</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>
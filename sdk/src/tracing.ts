import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { W3CBaggagePropagator } from '@opentelemetry/core';
import { CompositePropagator, TraceContextPropagator } from '@opentelemetry/core';
import { propagation, context, trace, Tracer } from '@opentelemetry/api';

let provider: NodeTracerProvider | null = null;
let initialized = false;

/**
 * Build a Resource describing this service for trace attribution.
 */
function buildResource(): Resource {
  const serviceName = process.env.OTEL_SERVICE_NAME || 'soroban-sdk';
  const serviceVersion = process.env.OTEL_SERVICE_VERSION || process.env.npm_package_version || '0.0.0';
  const deploymentEnv = process.env.NODE_ENV || 'development';

  return new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: deploymentEnv,
  });
}

/**
 * Determine whether the Jaeger exporter should be used.
 * Jaeger is used when OTEL_JAEGER_ENDPOINT is set or NODE_ENV=local.
 */
function shouldUseJaeger(): boolean {
  return Boolean(process.env.OTEL_JAEGER_ENDPOINT) || process.env.NODE_ENV === 'local';
}

/**
 * Initialize the OpenTelemetry tracing pipeline.
 *
 * - Uses the Jaeger exporter when OTEL_JAEGER_ENDPOINT is set or NODE_ENV=local.
 * - Otherwise uses the OTLP HTTP exporter pointed at OTEL_EXPORTER_OTLP_ENDPOINT
 *   (production).
 * - Registers W3C TraceContext and Baggage propagators so trace context flows
 *   across HTTP headers between services.
 *
 * Safe to call multiple times; subsequent calls are no-ops.
 */
export function initTracing(): NodeTracerProvider {
  if (initialized && provider) {
    return provider;
  }

  const resource = buildResource();
  provider = new NodeTracerProvider({ resource });

  if (shouldUseJaeger()) {
    const jaegerEndpoint = process.env.OTEL_JAEGER_ENDPOINT || 'http://localhost:14268/api/traces';
    const jaegerExporter = new JaegerExporter({
      endpoint: jaegerEndpoint,
    });
    provider.addSpanProcessor(new SimpleSpanProcessor(jaegerExporter));
  } else {
    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (otlpEndpoint) {
      const otlpExporter = new OTLPTraceExporter({
        url: otlpEndpoint,
        headers: parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
      });
      provider.addSpanProcessor(new BatchSpanProcessor(otlpExporter));
    }
  }

  provider.register();

  // Register W3C TraceContext + Baggage propagators for HTTP header propagation.
  const propagator = new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  });
  propagation.setGlobalPropagator(propagator);

  initialized = true;
  return provider;
}

/**
 * Parse OTEL_EXPORTER_OTLP_HEADERS (comma-separated key=value pairs) into a map.
 */
function parseOtlpHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) {
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (key) {
        headers[key] = value;
      }
    }
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Get a named tracer from the global tracer provider.
 * Initializes tracing lazily if it has not been set up yet.
 */
export function getTracer(name: string, version?: string): Tracer {
  if (!initialized) {
    initTracing();
  }
  return trace.getTracer(name, version);
}

/**
 * Flush pending spans and shut down the tracer provider.
 * Call this during graceful shutdown to avoid losing buffered spans.
 */
export async function shutdownTracing(): Promise<void> {
  if (!provider) {
    return;
  }
  try {
    await provider.shutdown();
  } finally {
    provider = null;
    initialized = false;
  }
}

/**
 * Extract trace context from incoming HTTP headers into an OTel context.
 * Useful for continuing a trace across service hops.
 */
export function extractTraceContext(headers: Record<string, string | string[] | undefined>) {
  return propagation.extract(context.active(), headers);
}

/**
 * Inject the current trace context into outgoing HTTP headers.
 * Mutates and returns the provided headers object.
 */
export function injectTraceContext(
  headers: Record<string, string>,
): Record<string, string> {
  propagation.inject(context.active(), headers);
  return headers;
}

export { TraceContextPropagator };
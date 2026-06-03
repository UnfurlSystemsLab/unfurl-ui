import type { RegisteredWebapp } from "./registry.js";

export type WebappLoadState =
  | {
      readonly status: "READY";
      readonly webapp: RegisteredWebapp;
    }
  | {
      readonly status: "FAILED";
      readonly webapp: RegisteredWebapp;
      readonly message: string;
      readonly retryable: boolean;
      readonly disabled: boolean;
    };

export function readyWebapp(webapp: RegisteredWebapp): WebappLoadState {
  return { status: "READY", webapp };
}

export function failedWebapp(
  webapp: RegisteredWebapp,
  error: unknown,
  options: { readonly retryable?: boolean; readonly disabled?: boolean } = {}
): WebappLoadState {
  return {
    status: "FAILED",
    webapp,
    message: errorMessage(error),
    retryable: options.retryable ?? true,
    disabled: options.disabled ?? false
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  return "component failed to load";
}

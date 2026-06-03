export type CompatibilityRange = string;

export type UnfurlMicroAppProps = {
  readonly mode: "hosted";
  readonly componentId: string;
  readonly tenantId: string;
  readonly user: {
    readonly id: string;
    readonly roles: readonly string[];
    readonly permissions: readonly string[];
  };
  readonly auth: {
    readonly getAccessToken: () => Promise<string>;
  };
  readonly api: {
    readonly platformBaseUrl: string;
    readonly componentBaseUrl: string;
  };
  readonly theme: {
    readonly activeThemeId: string;
    readonly tokens: Readonly<Record<string, string>>;
    readonly mode: "host" | "component-adaptive";
  };
  readonly eventBus: EventBus;
};

export type EventBus = {
  readonly publish: (eventName: string, payload: unknown) => void;
  readonly subscribe: (eventName: string, handler: (payload: unknown) => void) => () => void;
};

export type WebappCompatibility = {
  readonly hostShell: CompatibilityRange;
  readonly hostShellApi: CompatibilityRange;
  readonly microAppProps: CompatibilityRange;
  readonly eventBus: CompatibilityRange;
  readonly themeSystem: CompatibilityRange;
  readonly componentContract: string;
};

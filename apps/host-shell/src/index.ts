export type HostShellApp = {
  readonly appName: "@unfurl/host-shell";
  readonly routeBase: "/";
};

export const hostShellApp: HostShellApp = {
  appName: "@unfurl/host-shell",
  routeBase: "/"
};

export * from "./registry.js";
export * from "./microAppProps.js";
export * from "./activeTheme.js";
export * from "./accessControl.js";
export * from "./compatibility.js";
export * from "./loadState.js";

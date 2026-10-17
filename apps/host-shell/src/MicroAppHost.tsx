import { useEffect, useRef, useState } from "react";
import { mountRootParcel, type ParcelConfig } from "single-spa";
import type { UnfurlMicroAppProps } from "@unfurl/ui-contracts";
import type { RegisteredWebapp } from "./registry.js";
import type { StudioMountProps } from "../../fabric-studio-webapp/src/lifecycle.js";

/** Loader Strategy: execute built-in code or an explicitly approved deployment URL only. */
export async function loadWebapp(webapp: RegisteredWebapp, approvedUrls: readonly string[]): Promise<ParcelConfig<StudioMountProps>> {
  if (webapp.bundleUrl === "bundled:studio" && webapp.componentId === "fabric-studio") {
    return import("../../fabric-studio-webapp/src/lifecycle.js");
  }
  if (!approvedUrls.includes(webapp.bundleUrl) || !/^https?:\/\//.test(webapp.bundleUrl)) throw new Error("Unapproved webapp bundle");
  const module = await import(/* @vite-ignore */ webapp.bundleUrl);
  for (const lifecycle of ["bootstrap", "mount", "unmount"]) {
    if (typeof module[lifecycle] !== "function" && !Array.isArray(module[lifecycle])) throw new Error("Invalid webapp lifecycle");
  }
  return module;
}

/** Host Adapter: isolate single-spa lifecycle failures and release every owned mount. */
export function MicroAppHost({ webapp, props, approvedUrls, mode, assemblyId, localDevelopment }: {
  readonly webapp: RegisteredWebapp; readonly props: UnfurlMicroAppProps;
  readonly approvedUrls: readonly string[]; readonly mode: "live" | "fixture";
  readonly assemblyId: string; readonly localDevelopment: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = container.current!;
    // A separate child prevents late teardown from clearing a replacement mount.
    const child = document.createElement("div"); element.appendChild(child);
    let cancelled = false;
    let parcel: ReturnType<typeof mountRootParcel> | undefined;
    setError(undefined);
    void loadWebapp(webapp, approvedUrls).then(config => {
      if (cancelled) return;
      parcel = mountRootParcel(config, { ...props, domElement: child, studioMode: mode, assemblyId, localDevelopment });
      return parcel.mountPromise;
    }).catch(() => { if (!cancelled) setError("Component failed to load. Retry or select another component."); });
    return () => {
      cancelled = true;
      if (!parcel) { child.remove(); return; }
      void parcel.mountPromise.then(() => parcel!.unmount()).catch(() => undefined).finally(() => child.remove());
    };
  }, [webapp, props, approvedUrls, mode, assemblyId, localDevelopment, attempt]);
  return <><div ref={container} />{error && <section role="alert"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>Retry component</button></section>}</>;
}

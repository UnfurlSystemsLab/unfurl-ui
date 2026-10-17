import { Component, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import type { UnfurlMicroAppProps } from "@unfurl/ui-contracts";
import { AppRoutes } from "./StudioRoutes.js";
import { StudioClientProvider } from "./StudioClientContext.js";

export type StudioMountProps = UnfurlMicroAppProps & {
  readonly domElement: HTMLElement;
  readonly studioMode?: "live" | "fixture";
  readonly assemblyId?: string;
  readonly localDevelopment?: boolean;
};
const roots = new WeakMap<HTMLElement, Root>();

/** Boundary: contain product rendering errors inside the mounted webapp. */
class StudioBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  /** Lifecycle: render a truthful error without crashing the shell. */
  static getDerivedStateFromError() { return { failed: true }; }
  /** Presenter: preserve shell availability after a product render failure. */
  render() { return this.state.failed ? <p role="alert">Studio failed to render. Navigate away and retry.</p> : this.props.children; }
}

/** single-spa bootstrap: no process-global resources or authority are created. */
export async function bootstrap() { }

/** Adapter: mount Studio using only host-supplied context and client authentication. */
export async function mount(props: StudioMountProps) {
  if (roots.has(props.domElement)) throw new Error("Studio is already mounted");
  const root = createRoot(props.domElement);
  roots.set(props.domElement, root);
  root.render(<StudioBoundary><BrowserRouter>
    <StudioClientProvider mode={props.studioMode ?? "live"} apiBaseUrl={props.api.componentBaseUrl}
      tenantId={props.tenantId} assemblyId={props.assemblyId ?? "assembly-demo"}
      getAccessToken={props.localDevelopment ? undefined : props.auth.getAccessToken}>
      <AppRoutes />
    </StudioClientProvider>
  </BrowserRouter></StudioBoundary>);
}

/** Lifecycle: release React effects and subscriptions without canceling accepted backend work. */
export async function unmount(props: StudioMountProps) {
  roots.get(props.domElement)?.unmount();
  roots.delete(props.domElement);
}

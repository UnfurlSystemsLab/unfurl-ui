import { useEffect, useRef } from "react";
import * as THREE from "three";

export type ThreeAssemblySurfaceId =
  | "gateway"
  | "order"
  | "inventory"
  | "validation"
  | "payment"
  | "audit"
  | "notification"
  | "workflow"
  | "adapter"
  | "substrate";

export type ThreeAssemblySceneProps = {
  readonly activeView: string;
  readonly selectedSurface: ThreeAssemblySurfaceId;
  readonly onSelect: (surface: ThreeAssemblySurfaceId) => void;
};

type ModulePlacement = {
  readonly id: ThreeAssemblySurfaceId;
  readonly label: string;
  readonly color: number;
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
};

export function ThreeAssemblyScene({ activeView, selectedSurface, onSelect }: ThreeAssemblySceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  const selectedRef = useRef(selectedSurface);
  const viewRef = useRef(activeView);

  onSelectRef.current = onSelect;
  selectedRef.current = selectedSurface;
  viewRef.current = activeView;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const hostElement = host;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xdbeafe, 0.24);
    renderer.shadowMap.enabled = true;
    hostElement.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(6.4, 4.9, 8.2);
    camera.lookAt(0.05, -0.52, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb6c2d5, 2.4));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(4, 7, 6);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const moduleObjects = new Map<ThreeAssemblySurfaceId, THREE.Mesh>();
    const clickable: THREE.Object3D[] = [];
    const root = new THREE.Group();
    root.rotation.x = -0.04;
    root.rotation.y = -0.24;
    scene.add(root);

    addBasePlate(root);
    addGlassCabinet(root);
    addPipes(root);

    for (const module of modules) {
      const mesh = createModule(module);
      moduleObjects.set(module.id, mesh);
      clickable.push(mesh);
      root.add(mesh);
      addPortNubs(root, module);
    }

    const substrate = createSubstrateBlock();
    clickable.push(substrate);
    root.add(substrate);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function resize() {
      const rect = hostElement.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / Math.max(rect.height, 1);
      camera.updateProjectionMatrix();
    }

    function handlePointerDown(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickable, false)[0];
      const surface = hit?.object.userData.surface as ThreeAssemblySurfaceId | undefined;
      if (surface) {
        onSelectRef.current(surface);
      }
    }

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(hostElement);
    resize();

    let frame = 0;
    let raf = 0;
    function animate() {
      frame += 0.012;
      root.rotation.y = -0.24 + Math.sin(frame) * 0.018;
      for (const [id, object] of moduleObjects) {
        object.position.y = modulePlacementsById[id].position[1] + Math.sin(frame * 1.8 + object.position.x) * 0.025;
      }
      applySceneState(moduleObjects, substrate, selectedRef.current, viewRef.current);
      renderer.render(scene, camera);
      raf = window.requestAnimationFrame(animate);
    }
    animate();

    return () => {
      window.cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      hostElement.removeChild(renderer.domElement);
      renderer.dispose();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            material.dispose();
          }
        }
      });
    };
  }, []);

  return <div className="three-assembly-scene" aria-label="3D assembly scene" ref={hostRef} />;
}

function createModule(module: ModulePlacement): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(module.scale[0], module.scale[1], module.scale[2]);
  const material = new THREE.MeshStandardMaterial({
    color: module.color,
    roughness: 0.28,
    metalness: 0.34,
    emissive: module.color,
    emissiveIntensity: 0.06
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...module.position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.surface = module.id;

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x4b5563, transparent: true, opacity: 0.42 })
  );
  mesh.add(edge);
  return mesh;
}

function createSubstrateBlock(): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({
    color: 0xdbeafe,
    roughness: 0.55,
    metalness: 0.14,
    transparent: true,
    opacity: 0.82
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.32, 1.55), material);
  mesh.position.set(0, -2.18, 0.2);
  mesh.userData.surface = "substrate";
  mesh.receiveShadow = true;
  return mesh;
}

function addBasePlate(root: THREE.Group) {
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(9.2, 0.22, 5.7),
    new THREE.MeshStandardMaterial({ color: 0xdfe8f4, roughness: 0.3, metalness: 0.28 })
  );
  plate.position.set(0, -2.58, 0);
  plate.receiveShadow = true;
  root.add(plate);
}

function addGlassCabinet(root: THREE.Group) {
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(8.8, 3.95, 5.1),
    new THREE.MeshPhysicalMaterial({
      color: 0xb9e7ff,
      transparent: true,
      opacity: 0.2,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.36,
      thickness: 0.18
    })
  );
  glass.position.set(0, -0.5, 0);
  root.add(glass);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(8.84, 3.99, 5.14)),
    new THREE.LineBasicMaterial({ color: 0x2387aa, transparent: true, opacity: 0.88 })
  );
  edge.position.copy(glass.position);
  root.add(edge);
}

function addPipes(root: THREE.Group) {
  addPipe(root, [-2.55, -0.48, 0.86], [-1.12, -0.48, 0.72], 0x16a34a, 0.055);
  addPipe(root, [-1.05, -0.48, 0.72], [0.28, -0.48, 0.62], 0x16a34a, 0.055);
  addPipe(root, [0.96, -0.48, 0.62], [2.1, -0.55, 0.84], 0x16a34a, 0.055);
  addPipe(root, [0.52, -1.02, 0.52], [0.18, -2.02, 0.3], 0x2563eb, 0.052);
  addPipe(root, [-1.74, -1.54, 0.62], [0.18, -2.02, 0.3], 0xf59e0b, 0.05);
  addPipe(root, [-2.1, -1.42, 0.62], [-0.68, -1.54, 0.56], 0x64748b, 0.036);
  addPipe(root, [-0.2, -1.52, 0.56], [0.52, -1.35, 0.54], 0x64748b, 0.036);
}

function addPipe(root: THREE.Group, from: readonly [number, number, number], to: readonly [number, number, number], color: number, radius: number) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(...from),
    new THREE.Vector3((from[0] + to[0]) / 2, Math.max(from[1], to[1]) + 0.45, (from[2] + to[2]) / 2),
    new THREE.Vector3(...to)
  ]);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 34, radius, 10, false),
    new THREE.MeshStandardMaterial({ color, roughness: 0.22, metalness: 0.42 })
  );
  tube.castShadow = true;
  root.add(tube);
}

function addPortNubs(root: THREE.Group, module: ModulePlacement) {
  const nubMaterial = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.18, metalness: 0.5 });
  const offsets = [
    [module.scale[0] / 2 + 0.06, 0, 0],
    [-(module.scale[0] / 2 + 0.06), 0, 0],
    [0, -(module.scale[1] / 2 + 0.06), 0]
  ] as const;
  for (const offset of offsets) {
    const nub = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), nubMaterial);
    nub.position.set(module.position[0] + offset[0], module.position[1] + offset[1], module.position[2] + offset[2]);
    root.add(nub);
  }
}

function applySceneState(
  modulesById: Map<ThreeAssemblySurfaceId, THREE.Mesh>,
  substrate: THREE.Mesh,
  selected: ThreeAssemblySurfaceId,
  activeView: string
) {
  for (const [id, mesh] of modulesById) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.emissive.set(id === selected ? 0x3344ff : 0x000000);
    material.emissiveIntensity = id === selected ? 0.22 : 0;
    material.opacity = 1;
    material.transparent = false;
    mesh.scale.setScalar(id === selected ? 1.08 : 1);
    if (activeView === "Exploded" && id !== selected) {
      material.opacity = 0.5;
      material.transparent = true;
    }
    if (activeView === "Substrate" && id !== "adapter" && id !== "validation") {
      material.opacity = 0.45;
      material.transparent = true;
    }
    if (activeView === "Validation") {
      material.emissive.set(id === "adapter" ? 0x8a4b00 : 0x063b12);
      material.emissiveIntensity = id === "adapter" ? 0.16 : 0.1;
    }
  }
  const substrateMaterial = substrate.material as THREE.MeshStandardMaterial;
  substrateMaterial.emissive.set(selected === "substrate" || activeView === "Substrate" ? 0x1144aa : 0x000000);
  substrateMaterial.emissiveIntensity = selected === "substrate" || activeView === "Substrate" ? 0.2 : 0;
}

const modules = [
  { id: "gateway", label: "API Gateway", color: 0xffffff, position: [0, 1.02, 0.45], scale: [1.72, 0.72, 0.86] },
  { id: "order", label: "Order Service", color: 0xf8fafc, position: [-2.62, -0.42, 0.76], scale: [1.18, 0.9, 0.96] },
  { id: "inventory", label: "Inventory Service", color: 0xf8fafc, position: [-1.12, -0.44, 0.66], scale: [1.18, 0.9, 0.96] },
  { id: "validation", label: "Validation Service", color: 0xf4f0ff, position: [0.32, -0.44, 0.6], scale: [1.32, 1.1, 1.02] },
  { id: "payment", label: "Payment Service", color: 0xf8fafc, position: [1.82, -0.48, 0.7], scale: [1.18, 0.9, 0.96] },
  { id: "audit", label: "Audit Service", color: 0xf8fafc, position: [-2.18, -1.58, 0.52], scale: [1.12, 0.9, 0.9] },
  { id: "notification", label: "Notification Service", color: 0xfffbeb, position: [-0.78, -1.66, 0.5], scale: [1.12, 0.9, 0.9] },
  { id: "workflow", label: "Workflow Service", color: 0xf8fafc, position: [0.62, -1.56, 0.5], scale: [1.12, 0.9, 0.9] },
  { id: "adapter", label: "Storage Adapter", color: 0xfff1f2, position: [2.12, -1.62, 0.46], scale: [1.12, 0.9, 0.9] }
] as const satisfies readonly ModulePlacement[];

const modulePlacementsById = Object.fromEntries(modules.map(module => [module.id, module])) as Record<ModulePlacement["id"], ModulePlacement>;

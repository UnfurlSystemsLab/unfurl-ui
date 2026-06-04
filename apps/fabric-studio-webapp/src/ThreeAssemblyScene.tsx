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
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(6.8, 5.2, 9.4);
    camera.lookAt(0.2, 0.1, 0);

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
    roughness: 0.34,
    metalness: 0.28,
    emissive: module.color,
    emissiveIntensity: 0.03
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...module.position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.surface = module.id;

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.52 })
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
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.26, 1.3), material);
  mesh.position.set(0, -2.15, 0.25);
  mesh.userData.surface = "substrate";
  mesh.receiveShadow = true;
  return mesh;
}

function addBasePlate(root: THREE.Group) {
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(8.6, 0.18, 5.3),
    new THREE.MeshStandardMaterial({ color: 0xe6edf6, roughness: 0.36, metalness: 0.2 })
  );
  plate.position.set(0, -2.58, 0);
  plate.receiveShadow = true;
  root.add(plate);
}

function addGlassCabinet(root: THREE.Group) {
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(8.2, 3.7, 4.8),
    new THREE.MeshPhysicalMaterial({
      color: 0xb9e7ff,
      transparent: true,
      opacity: 0.1,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.45,
      thickness: 0.18
    })
  );
  glass.position.set(0, -0.5, 0);
  root.add(glass);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(8.22, 3.72, 4.82)),
    new THREE.LineBasicMaterial({ color: 0x4aa3c7, transparent: true, opacity: 0.7 })
  );
  edge.position.copy(glass.position);
  root.add(edge);
}

function addPipes(root: THREE.Group) {
  addPipe(root, [-2.5, -0.8, 0.8], [-0.75, -0.55, 0.5], 0x16a34a);
  addPipe(root, [-0.65, -0.55, 0.5], [0.65, -0.52, 0.42], 0x16a34a);
  addPipe(root, [0.8, -0.52, 0.42], [2.3, -0.72, 0.68], 0x16a34a);
  addPipe(root, [0.58, -1.12, 0.32], [0.2, -2.05, 0.2], 0x2563eb);
  addPipe(root, [-2.0, -1.55, 0.45], [0.2, -2.05, 0.2], 0xf59e0b);
}

function addPipe(root: THREE.Group, from: readonly [number, number, number], to: readonly [number, number, number], color: number) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(...from),
    new THREE.Vector3((from[0] + to[0]) / 2, Math.max(from[1], to[1]) + 0.45, (from[2] + to[2]) / 2),
    new THREE.Vector3(...to)
  ]);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 28, 0.035, 8, false),
    new THREE.MeshStandardMaterial({ color, roughness: 0.22, metalness: 0.42 })
  );
  tube.castShadow = true;
  root.add(tube);
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
  { id: "gateway", label: "API Gateway", color: 0xffffff, position: [0, 0.95, 0.15], scale: [1.6, 0.7, 0.8] },
  { id: "order", label: "Order Service", color: 0xf8fafc, position: [-2.55, -0.55, 0.55], scale: [1.1, 0.82, 0.86] },
  { id: "inventory", label: "Inventory Service", color: 0xf8fafc, position: [-1.12, -0.62, 0.42], scale: [1.1, 0.82, 0.86] },
  { id: "validation", label: "Validation Service", color: 0xf5f3ff, position: [0.32, -0.58, 0.34], scale: [1.22, 1.02, 0.92] },
  { id: "payment", label: "Payment Service", color: 0xf8fafc, position: [1.82, -0.62, 0.42], scale: [1.1, 0.82, 0.86] },
  { id: "audit", label: "Audit Service", color: 0xf8fafc, position: [-2.2, -1.72, 0.32], scale: [1.05, 0.82, 0.82] },
  { id: "notification", label: "Notification Service", color: 0xf8fafc, position: [-0.8, -1.8, 0.28], scale: [1.05, 0.82, 0.82] },
  { id: "workflow", label: "Workflow Service", color: 0xf8fafc, position: [0.58, -1.72, 0.32], scale: [1.05, 0.82, 0.82] },
  { id: "adapter", label: "Storage Adapter", color: 0xfff1f2, position: [2.1, -1.78, 0.28], scale: [1.05, 0.82, 0.82] }
] as const satisfies readonly ModulePlacement[];

const modulePlacementsById = Object.fromEntries(modules.map(module => [module.id, module])) as Record<ModulePlacement["id"], ModulePlacement>;

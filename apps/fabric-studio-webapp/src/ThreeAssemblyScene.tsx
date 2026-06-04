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
  readonly id: Exclude<ThreeAssemblySurfaceId, "substrate">;
  readonly label: string;
  readonly badge: string;
  readonly accent: number;
  readonly portColor: number;
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
};

type SceneHandles = {
  readonly moduleGroups: Map<ThreeAssemblySurfaceId, THREE.Group>;
  readonly moduleBodies: Map<ThreeAssemblySurfaceId, THREE.Mesh>;
  readonly explodedGroup: THREE.Group;
  readonly substrateGroup: THREE.Group;
  readonly substratePlate: THREE.Mesh;
  readonly validationLines: readonly THREE.Line[];
  readonly modeGroups: {
    readonly portGroup: THREE.Group;
    readonly substrateLinks: THREE.Group;
  };
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
    renderer.setClearColor(0xf8fbff, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    hostElement.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xf8fbff, 10, 22);

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(7.9, 5.0, 10.2);
    camera.lookAt(0.2, -0.7, 0.12);

    addLighting(scene);

    const clickable: THREE.Object3D[] = [];
    const root = new THREE.Group();
    root.rotation.x = -0.06;
    root.rotation.y = -0.23;
    root.position.set(-0.34, 0.0, -0.05);
    scene.add(root);

    const handles = buildAssembly(root, clickable);

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
      const hit = raycaster.intersectObjects(clickable, true)[0];
      const surface = resolveSurface(hit?.object);
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
      frame += 0.01;
      root.rotation.y = -0.23 + Math.sin(frame * 0.8) * 0.01;
      root.rotation.x = -0.06 + Math.sin(frame * 0.55) * 0.006;
      handles.explodedGroup.position.y = -0.42 + Math.sin(frame * 1.4) * 0.018;
      applySceneState(handles, selectedRef.current, viewRef.current, frame);
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
      disposeObject(scene);
    };
  }, []);

  return <div className="three-assembly-scene" aria-label="3D assembly scene" ref={hostRef} />;
}

function addLighting(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c7db, 2.8));

  const keyLight = new THREE.DirectionalLight(0xffffff, 3.1);
  keyLight.position.set(4.8, 7.8, 5.2);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 22;
  keyLight.shadow.camera.left = -8;
  keyLight.shadow.camera.right = 8;
  keyLight.shadow.camera.top = 7;
  keyLight.shadow.camera.bottom = -7;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xbbe8ff, 1.35);
  rimLight.position.set(-5, 3, -6);
  scene.add(rimLight);

  const purpleLight = new THREE.PointLight(0x7c3aed, 1.45, 7.5);
  purpleLight.position.set(2.2, 1.3, 2.8);
  scene.add(purpleLight);
}

function buildAssembly(root: THREE.Group, clickable: THREE.Object3D[]): SceneHandles {
  const moduleGroups = new Map<ThreeAssemblySurfaceId, THREE.Group>();
  const moduleBodies = new Map<ThreeAssemblySurfaceId, THREE.Mesh>();

  addWorkbenchBase(root);
  addGlassEnclosure(root);

  const pipeGroup = new THREE.Group();
  root.add(pipeGroup);
  addServicePipes(pipeGroup);

  const portGroup = new THREE.Group();
  root.add(portGroup);

  for (const module of modules) {
    const group = createModule(module);
    moduleGroups.set(module.id, group);
    const body = group.userData.body as THREE.Mesh;
    moduleBodies.set(module.id, body);
    clickable.push(body);
    root.add(group);
    addModulePorts(portGroup, module);
  }

  const substrateGroup = createSubstrateBase();
  const substratePlate = substrateGroup.userData.plate as THREE.Mesh;
  moduleGroups.set("substrate", substrateGroup);
  moduleBodies.set("substrate", substratePlate);
  clickable.push(substratePlate);
  root.add(substrateGroup);

  const substrateLinks = createSubstrateLinks();
  root.add(substrateLinks);

  const { explodedGroup, validationLines } = createExplodedModule();
  clickable.push(explodedGroup.userData.body as THREE.Mesh);
  root.add(explodedGroup);

  return {
    moduleGroups,
    moduleBodies,
    explodedGroup,
    substrateGroup,
    substratePlate,
    validationLines,
    modeGroups: { portGroup, substrateLinks }
  };
}

function addWorkbenchBase(root: THREE.Group) {
  const baseMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xe9eef6,
    roughness: 0.24,
    metalness: 0.32,
    clearcoat: 0.45,
    clearcoatRoughness: 0.18
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(9.7, 0.24, 6.1), baseMaterial);
  base.position.set(0, -2.64, 0);
  base.receiveShadow = true;
  root.add(base);

  const bevel = new THREE.Mesh(
    new THREE.BoxGeometry(9.28, 0.08, 5.68),
    new THREE.MeshStandardMaterial({ color: 0xf8fbff, roughness: 0.32, metalness: 0.12 })
  );
  bevel.position.set(0, -2.46, 0);
  bevel.receiveShadow = true;
  root.add(bevel);

  const screwMaterial = new THREE.MeshStandardMaterial({ color: 0x5f7188, roughness: 0.18, metalness: 0.86 });
  for (const [x, z] of [
    [-4.25, -2.45],
    [4.25, -2.45],
    [-4.25, 2.45],
    [4.25, 2.45],
    [-3.2, 2.45],
    [3.2, 2.45]
  ] as const) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.035, 28), screwMaterial);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(x, -2.37, z);
    root.add(screw);
  }
}

function addGlassEnclosure(root: THREE.Group) {
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xbcecff,
    transparent: true,
    opacity: 0.18,
    roughness: 0.04,
    metalness: 0,
    transmission: 0.44,
    thickness: 0.24,
    clearcoat: 0.7,
    clearcoatRoughness: 0.05,
    side: THREE.DoubleSide
  });

  const glass = new THREE.Mesh(new THREE.BoxGeometry(8.75, 3.72, 5.04), glassMaterial);
  glass.position.set(-0.34, -0.62, 0.08);
  root.add(glass);

  const edgeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(8.82, 3.78, 5.1));
  const edge = new THREE.LineSegments(
    edgeGeometry,
    new THREE.LineBasicMaterial({ color: 0x0e7490, transparent: true, opacity: 0.7 })
  );
  edge.position.copy(glass.position);
  root.add(edge);

  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x9caaba, roughness: 0.18, metalness: 0.72 });
  const cornerPositions = [
    [-4.76, -2.45, -2.52],
    [4.08, -2.45, -2.52],
    [-4.76, -2.45, 2.58],
    [4.08, -2.45, 2.58],
    [-4.76, 1.28, -2.52],
    [4.08, 1.28, -2.52],
    [-4.76, 1.28, 2.58],
    [4.08, 1.28, 2.58]
  ] as const;
  for (const position of cornerPositions) {
    const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), railMaterial);
    bolt.position.set(position[0], position[1], position[2]);
    bolt.castShadow = true;
    root.add(bolt);
  }

  addRail(root, [-4.76, 1.28, -2.52], [4.08, 1.28, -2.52], railMaterial);
  addRail(root, [-4.76, 1.28, 2.58], [4.08, 1.28, 2.58], railMaterial);
  addRail(root, [-4.76, -2.45, -2.52], [4.08, -2.45, -2.52], railMaterial);
  addRail(root, [-4.76, -2.45, 2.58], [4.08, -2.45, 2.58], railMaterial);
}

function addRail(root: THREE.Group, from: readonly [number, number, number], to: readonly [number, number, number], material: THREE.Material) {
  const curve = new THREE.LineCurve3(new THREE.Vector3(...from), new THREE.Vector3(...to));
  const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.018, 10), material);
  rail.castShadow = true;
  root.add(rail);
}

function createModule(module: ModulePlacement): THREE.Group {
  const group = new THREE.Group();
  group.position.set(...module.position);
  group.userData.surface = module.id;

  const labelTexture = createLabelTexture(module.label, module.badge, module.accent);
  const shellMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf9fbfd,
    roughness: 0.2,
    metalness: 0.18,
    clearcoat: 0.62,
    clearcoatRoughness: 0.08
  });
  const sideMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xdfe7f0,
    roughness: 0.22,
    metalness: 0.42,
    clearcoat: 0.42,
    clearcoatRoughness: 0.14
  });
  const faceMaterial = new THREE.MeshStandardMaterial({ map: labelTexture, roughness: 0.26, metalness: 0.05 });
  const materials = [sideMaterial, sideMaterial, sideMaterial, sideMaterial, faceMaterial, shellMaterial];
  const body = new THREE.Mesh(new THREE.BoxGeometry(module.scale[0], module.scale[1], module.scale[2]), materials);
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.surface = module.id;
  group.userData.body = body;
  group.add(body);

  const accentPlate = new THREE.Mesh(
    new THREE.BoxGeometry(module.scale[0] * 0.74, 0.035, 0.026),
    new THREE.MeshStandardMaterial({ color: module.accent, roughness: 0.2, metalness: 0.4, emissive: module.accent, emissiveIntensity: 0.05 })
  );
  accentPlate.position.set(0, -module.scale[1] / 2 + 0.035, module.scale[2] / 2 + 0.02);
  group.add(accentPlate);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(module.scale[0] + 0.01, module.scale[1] + 0.01, module.scale[2] + 0.01)),
    new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.48 })
  );
  group.add(edge);

  const screwMaterial = new THREE.MeshStandardMaterial({ color: 0x718096, roughness: 0.18, metalness: 0.88 });
  for (const [x, y] of [
    [-module.scale[0] / 2 + 0.12, module.scale[1] / 2 - 0.12],
    [module.scale[0] / 2 - 0.12, module.scale[1] / 2 - 0.12],
    [-module.scale[0] / 2 + 0.12, -module.scale[1] / 2 + 0.12],
    [module.scale[0] / 2 - 0.12, -module.scale[1] / 2 + 0.12]
  ] as const) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.018, 16), screwMaterial);
    screw.position.set(x, y, module.scale[2] / 2 + 0.026);
    screw.rotation.x = Math.PI / 2;
    group.add(screw);
  }

  return group;
}

function createLabelTexture(label: string, badge: string, accent: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const context = canvas.getContext("2d");
  if (!context) {
    return new THREE.CanvasTexture(canvas);
  }

  context.fillStyle = "#f8fafc";
  roundRect(context, 0, 0, canvas.width, canvas.height, 28);
  context.fill();

  const accentHex = `#${accent.toString(16).padStart(6, "0")}`;
  context.fillStyle = accentHex;
  roundRect(context, 180, 34, 152, 92, 24);
  context.fill();
  context.strokeStyle = "rgba(255,255,255,0.7)";
  context.lineWidth = 8;
  context.stroke();

  context.fillStyle = "#ffffff";
  context.font = "900 58px Inter, Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(badge, 256, 82);

  context.fillStyle = "#0f172a";
  context.font = "800 34px Inter, Arial, sans-serif";
  const words = label.split(" ");
  if (words.length > 1) {
    context.fillText(words.slice(0, -1).join(" "), 256, 188);
    context.fillText(words[words.length - 1] ?? label, 256, 232);
  } else {
    context.fillText(label, 256, 210);
  }

  context.fillStyle = accentHex;
  roundRect(context, 108, 270, 296, 12, 7);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function addModulePorts(root: THREE.Group, module: ModulePlacement) {
  const material = new THREE.MeshStandardMaterial({
    color: module.portColor,
    roughness: 0.14,
    metalness: 0.72,
    emissive: module.portColor,
    emissiveIntensity: 0.08
  });
  const ringMaterial = new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.16, metalness: 0.62 });
  const sideX = module.scale[0] / 2 + 0.05;
  const bottomY = -(module.scale[1] / 2 + 0.06);
  const frontZ = module.scale[2] / 2 + 0.06;
  const positions = [
    [sideX, 0.18, frontZ],
    [-sideX, -0.04, frontZ],
    [0, bottomY, frontZ]
  ] as const;

  for (const [x, y, z] of positions) {
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 20), material);
    socket.rotation.x = Math.PI / 2;
    socket.position.set(module.position[0] + x, module.position[1] + y, module.position[2] + z);
    root.add(socket);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.014, 10, 24), ringMaterial);
    ring.position.copy(socket.position);
    ring.rotation.x = Math.PI / 2;
    root.add(ring);
  }
}

function addServicePipes(root: THREE.Group) {
  const metal = 0x778899;
  addPipe(root, [-3.2, 0.45, 1.22], [-1.72, 0.45, 1.12], metal, 0.045, true);
  addPipe(root, [-1.74, 0.45, 1.12], [-0.4, 0.48, 1.06], metal, 0.045, true);
  addPipe(root, [0.4, 0.48, 1.06], [1.76, 0.43, 1.15], metal, 0.045, true);
  addPipe(root, [0.25, -0.45, 1.1], [0.45, -1.45, 1.0], 0x2563eb, 0.042, false);
  addPipe(root, [-2.05, -1.55, 1.05], [0.45, -1.45, 1.0], 0x64748b, 0.035, true);
  addPipe(root, [-0.74, -1.55, 0.98], [1.88, -1.55, 1.03], 0x64748b, 0.035, true);
  addPipe(root, [2.08, -1.45, 1.03], [2.5, -2.08, 0.8], 0x2563eb, 0.035, false);
}

function addPipe(
  root: THREE.Group,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  color: number,
  radius: number,
  withJoints: boolean
) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(...from),
    new THREE.Vector3((from[0] + to[0]) / 2, Math.max(from[1], to[1]) + 0.34, (from[2] + to[2]) / 2),
    new THREE.Vector3(...to)
  ]);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 42, radius, 14, false),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.16,
      metalness: 0.78,
      emissive: color === 0x2563eb ? 0x0b3b9b : 0x000000,
      emissiveIntensity: color === 0x2563eb ? 0.12 : 0
    })
  );
  tube.castShadow = true;
  root.add(tube);

  if (withJoints) {
    const jointMaterial = new THREE.MeshStandardMaterial({ color: 0x5b6778, roughness: 0.14, metalness: 0.88 });
    for (const point of [from, to]) {
      const joint = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.75, 18, 12), jointMaterial);
      joint.position.set(...point);
      joint.castShadow = true;
      root.add(joint);
    }
  }
}

function createSubstrateBase(): THREE.Group {
  const group = new THREE.Group();
  group.userData.surface = "substrate";

  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(8.8, 0.36, 1.34),
    new THREE.MeshPhysicalMaterial({
      color: 0xe8eef7,
      roughness: 0.24,
      metalness: 0.18,
      clearcoat: 0.38,
      clearcoatRoughness: 0.12
    })
  );
  plate.position.set(0.05, -2.13, 2.1);
  plate.userData.surface = "substrate";
  plate.receiveShadow = true;
  group.userData.plate = plate;
  group.add(plate);

  const substrateItems = [
    ["J21", 0xf97316],
    ["SB", 0x16a34a],
    ["PG", 0x2563eb],
    ["RD", 0xdc2626],
    ["KF", 0x111827],
    ["NG", 0x16a34a],
    ["DK", 0x0ea5e9],
    ["K8", 0x2563eb],
    ["VT", 0x111827],
    ["PM", 0xea580c],
    ["GF", 0xf97316]
  ] as const;

  substrateItems.forEach(([label, color], index) => {
    const x = -3.95 + index * 0.78;
    const tile = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.08, 0.72),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.06 })
    );
    tile.position.set(x, -1.9, 2.1);
    tile.castShadow = true;
    tile.receiveShadow = true;
    group.add(tile);

    const chip = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.05, 0.28),
      new THREE.MeshStandardMaterial({ color, roughness: 0.18, metalness: 0.3, emissive: color, emissiveIntensity: 0.08 })
    );
    chip.position.set(x, -1.84, 1.98);
    group.add(chip);

    const labelSprite = createTextSprite(label, "#0f172a", "rgba(255,255,255,0)");
    labelSprite.scale.set(0.28, 0.14, 1);
    labelSprite.position.set(x, -1.79, 2.26);
    group.add(labelSprite);

    const status = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 12, 8),
      new THREE.MeshStandardMaterial({ color: index < 6 ? 0x16a34a : 0x94a3b8, emissive: index < 6 ? 0x16a34a : 0x000000, emissiveIntensity: 0.2 })
    );
    status.position.set(x, -1.76, 2.47);
    group.add(status);
  });

  const title = createTextSprite("SUBSTRATE RUNTIME LAYER", "#1d4ed8", "rgba(255,255,255,0.72)");
  title.scale.set(1.6, 0.28, 1);
  title.position.set(-3.35, -1.72, 2.82);
  group.add(title);

  return group;
}

function createSubstrateLinks(): THREE.Group {
  const group = new THREE.Group();
  addPipe(group, [0.42, -1.05, 1.1], [0.6, -1.85, 2.0], 0x2563eb, 0.025, false);
  addPipe(group, [2.12, -1.15, 1.12], [2.4, -1.85, 2.0], 0x2563eb, 0.025, false);
  addPipe(group, [-2.1, -1.18, 1.12], [-1.98, -1.85, 2.0], 0x0ea5e9, 0.025, false);
  return group;
}

function createExplodedModule(): { explodedGroup: THREE.Group; validationLines: readonly THREE.Line[] } {
  const exploded = createModule({
    id: "validation",
    label: "Validation Service",
    badge: "V",
    accent: 0x7c3aed,
    portColor: 0x7c3aed,
    position: [0, 0, 0],
    scale: [1.34, 1.22, 1.08]
  });
  exploded.position.set(4.5, -0.18, 0.62);
  exploded.rotation.y = -0.08;
  exploded.userData.surface = "validation";

  const body = exploded.userData.body as THREE.Mesh;
  body.userData.surface = "validation";

  const glow = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.48, 1.36, 1.2)),
    new THREE.LineBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.86 })
  );
  exploded.add(glow);

  const sockets = new THREE.Group();
  const socketMaterial = new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.12, metalness: 0.76, emissive: 0x7c3aed, emissiveIntensity: 0.14 });
  for (let index = 0; index < 5; index += 1) {
    const socket = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 10, 24), socketMaterial);
    socket.rotation.x = Math.PI / 2;
    socket.position.set(-0.44 + index * 0.22, -0.72, 0.6);
    sockets.add(socket);
  }
  exploded.add(sockets);

  const validationLines = [
    addDashedLine([0.32, -0.44, 1.25], [4.18, -0.2, 1.38]),
    addDashedLine([0.32, -0.62, 1.25], [4.18, -0.58, 1.38]),
    addDashedLine([0.32, -0.82, 1.25], [4.18, -0.96, 1.38])
  ];

  return { explodedGroup: exploded, validationLines };
}

function addDashedLine(from: readonly [number, number, number], to: readonly [number, number, number]): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
  const line = new THREE.Line(
    geometry,
    new THREE.LineDashedMaterial({ color: 0x7c3aed, dashSize: 0.12, gapSize: 0.09, transparent: true, opacity: 0.7 })
  );
  line.computeLineDistances();
  return line;
}

function createTextSprite(text: string, color: string, background: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = background;
    roundRect(context, 0, 0, 512, 128, 22);
    context.fill();
    context.fillStyle = color;
    context.font = "800 44px Inter, Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 256, 66);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  return sprite;
}

function applySceneState(handles: SceneHandles, selected: ThreeAssemblySurfaceId, activeView: string, frame: number) {
  for (const [id, group] of handles.moduleGroups) {
    const body = handles.moduleBodies.get(id);
    if (!body) {
      continue;
    }
    const selectedThis = id === selected;
    const dimmedForExploded = activeView === "Exploded" && !selectedThis && id !== "substrate";
    const dimmedForSubstrate = activeView === "Substrate" && id !== "substrate" && id !== "adapter" && id !== "validation";
    const dimmed = dimmedForExploded || dimmedForSubstrate;

    const base = modulePlacementsById[id as ModulePlacement["id"]];
    if (base) {
      group.position.y = base.position[1] + Math.sin(frame * 1.7 + base.position[0]) * 0.014;
    }
    group.scale.setScalar(selectedThis ? 1.055 : 1);
    setObjectOpacity(group, dimmed ? 0.44 : 1);

    const emissiveColor = selectedThis ? 0x7c3aed : activeView === "Validation" ? 0x16a34a : 0x000000;
    const materials = Array.isArray(body.material) ? body.material : [body.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
        material.emissive.set(emissiveColor);
        material.emissiveIntensity = selectedThis ? 0.18 : activeView === "Validation" ? 0.035 : 0;
      }
    }
  }

  const substrateActive = selected === "substrate" || activeView === "Substrate";
  const substrateMaterial = handles.substratePlate.material;
  if (substrateMaterial instanceof THREE.MeshStandardMaterial || substrateMaterial instanceof THREE.MeshPhysicalMaterial) {
    substrateMaterial.emissive.set(substrateActive ? 0x2563eb : 0x000000);
    substrateMaterial.emissiveIntensity = substrateActive ? 0.12 : 0;
  }

  handles.explodedGroup.visible = true;
  setObjectOpacity(handles.explodedGroup, activeView === "Substrate" ? 0.58 : 1);
  handles.explodedGroup.scale.setScalar(selected === "validation" ? 1.03 : 0.96);

  for (const line of handles.validationLines) {
    line.visible = activeView !== "Substrate";
    const material = line.material;
    if (material instanceof THREE.LineDashedMaterial) {
      material.opacity = selected === "validation" || activeView === "Ports" ? 0.86 : 0.48;
    }
    if (!line.parent) {
      handles.explodedGroup.parent?.add(line);
    }
  }

  setObjectOpacity(handles.modeGroups.portGroup, activeView === "Ports" ? 1 : 0.78);
  setObjectOpacity(handles.modeGroups.substrateLinks, activeView === "Substrate" ? 1 : 0.64);
}

function setObjectOpacity(object: THREE.Object3D, opacity: number) {
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Sprite)) {
      return;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if ("opacity" in material) {
        material.opacity = opacity;
        material.transparent = opacity < 1 || material.transparent;
      }
    }
  });
}

function resolveSurface(object: THREE.Object3D | undefined): ThreeAssemblySurfaceId | undefined {
  let current: THREE.Object3D | null | undefined = object;
  while (current) {
    const surface = current.userData.surface as ThreeAssemblySurfaceId | undefined;
    if (surface) {
      return surface;
    }
    current = current.parent;
  }
  return undefined;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Sprite) {
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) {
            value.dispose();
          }
        }
        material.dispose();
      }
    }
  });
}

const modules = [
  { id: "gateway", label: "API Gateway", badge: "N", accent: 0x16a34a, portColor: 0x16a34a, position: [0, 0.96, 0.48], scale: [1.72, 0.68, 0.78] },
  { id: "order", label: "Order Service", badge: "O", accent: 0x65a30d, portColor: 0x16a34a, position: [-2.55, -0.38, 0.74], scale: [1.16, 0.9, 0.94] },
  { id: "inventory", label: "Inventory Service", badge: "I", accent: 0x65a30d, portColor: 0x16a34a, position: [-1.12, -0.42, 0.68], scale: [1.16, 0.9, 0.94] },
  { id: "validation", label: "Validation Service", badge: "V", accent: 0x7c3aed, portColor: 0x7c3aed, position: [0.32, -0.42, 0.62], scale: [1.24, 1.08, 1.02] },
  { id: "payment", label: "Payment Service", badge: "P", accent: 0x65a30d, portColor: 0x16a34a, position: [1.78, -0.46, 0.72], scale: [1.16, 0.9, 0.94] },
  { id: "audit", label: "Audit Service", badge: "A", accent: 0x2563eb, portColor: 0x2563eb, position: [-2.08, -1.54, 0.52], scale: [1.1, 0.88, 0.86] },
  { id: "notification", label: "Notification Service", badge: "F", accent: 0xea580c, portColor: 0xf59e0b, position: [-0.72, -1.62, 0.5], scale: [1.1, 0.88, 0.86] },
  { id: "workflow", label: "Workflow Service", badge: "W", accent: 0x0ea5e9, portColor: 0x0ea5e9, position: [0.64, -1.52, 0.5], scale: [1.1, 0.88, 0.86] },
  { id: "adapter", label: "Storage Adapter", badge: "S", accent: 0xdc2626, portColor: 0x2563eb, position: [2.12, -1.58, 0.48], scale: [1.1, 0.88, 0.86] }
] as const satisfies readonly ModulePlacement[];

const modulePlacementsById = Object.fromEntries(modules.map(module => [module.id, module])) as Record<ModulePlacement["id"], ModulePlacement>;

# ETHER — 缄默之境

A small, offline-first browser artwork for placing local photographs into a quiet Three.js space. Photos are textured 3D planes with independent inertial drift; drag a photo to move it, drag the background to orbit or pan, and use the wheel to change viewing distance. Clicking a photo continuously breaks it into eight irregular, UV-mapped Voronoi paper pieces. The monochrome pieces are scattered with different rotations. Drag them near their matching positions and they snap into place and regain color; double-click empty space to scatter them again, or use **恢复原照片** to smoothly reunite them with the image.

## Run

From this folder, run the included local static server (Node.js 18 or newer):

```powershell
node serve.mjs
```

Then open <http://127.0.0.1:8001>. Stop the server with `Ctrl+C`. The server binds only to this computer. A local server is needed for JavaScript modules, WebGL, and IndexedDB. Three.js 0.180.0 and its OrbitControls module are bundled under `vendor/three/`, so the artwork makes no network requests and loads no remote libraries or assets. The bundled Three.js files are MIT licensed; see `vendor/three/LICENSE`.

## Local storage and privacy

Imported image files, locally generated display previews, and any date, title, or note are stored in this browser's IndexedDB database named `ether-archive-local`. Nothing is uploaded. The app does not store source filenames, image paths, or private text in logs. Large images are kept intact in browser storage; a separate display preview is generated at up to 1800 pixels on the longest edge.

The browser restores the archive when opened again at the same browser and origin (`http://127.0.0.1:8001`). Changing the address or port creates a separate browser origin. Use **清空记忆** in the artwork, or clear this site's storage in browser settings, to remove the locally stored archive. Clearing browser site data also removes it. Imported files and their local data do not change the original files on disk.

Photos without user-entered dates remain undated. The rewind controls follow import order. Supported image types are JPEG, PNG, and WebP, up to 25 MB each.

## Controls

- Drag a photo itself to move it in a camera-facing 3D plane. A short click starts its collage animation.
- Drag the empty space to orbit or pan the scene; use the mouse wheel to change camera distance.
- In puzzle mode, hover or click a shard to lift it slightly, then drag it near the matching place to snap it into position. Correctly placed pieces regain color. Double-click empty space to scramble them again.
- Choose **恢复原照片** or press `Esc` to animate the current shard positions back into the photograph.
- Keyboard users can open photos from the hidden accessible photo list and use the visible controls; reduced motion remains available in the header.

## Public deployment

The `public/` folder contains the browser-ready site assets, and `render.yaml` configures a Render static site. To publish it, put this project in a Git repository and connect that repository to Render. Visitor photos stay in each visitor's browser storage and are not uploaded with the site.


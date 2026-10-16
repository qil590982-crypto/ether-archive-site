# ETHER — 缄默之境

**在线体验：** [https://qil590982-crypto.github.io/ether-archive-site/](https://qil590982-crypto.github.io/ether-archive-site/)  
**公开源代码：** [GitHub 仓库](https://github.com/qil590982-crypto/ether-archive-site)

ETHER is a quiet, offline-first browser artwork for placing photographs into a Three.js space. Photos drift as independent 3D objects; drag a photo to move it, drag empty space to observe the scene, and use the wheel to change viewing distance. Clicking a photo continuously breaks it into eight irregular, UV-mapped paper pieces. Drag pieces near their matching positions to snap them into place and restore their color.

## Use

Open the live site and choose **放入照片**. JPEG, PNG, and WebP images up to 25 MB are supported.

Each visitor's photos, previews, dates, titles, and notes stay in that visitor's browser's IndexedDB storage. The site does not upload them. Photos you add are visible only in the browser and device where you added them; other people who open the link will see their own archive and can add their own photos.

Stored photos persist when the same browser opens the same site address again. The live site and a local copy use separate browser storage. Use **清空记忆** in the artwork, or clear this site's storage in browser settings, to remove an archive. Clearing browser site data also removes it. Imported files and their local data do not change the original files on disk.

Photos without user-entered dates remain undated. The rewind controls follow import order.

## Controls

- Drag a photo itself to move it in a camera-facing 3D plane. A short click starts its collage animation.
- Drag empty space to orbit or pan the scene; use the mouse wheel to change camera distance.
- In puzzle mode, hover or click a shard to lift it slightly, then drag it near the matching place to snap it into position. Correctly placed pieces regain color. Double-click empty space to scramble them again.
- Choose **恢复原照片** or press `Esc` to animate the current shard positions back into the photograph.
- Keyboard users can open photos from the hidden accessible photo list and use the visible controls; reduced motion remains available in the header.

## Deployment

GitHub Actions publishes the `public/` directory to GitHub Pages whenever a commit is pushed to `main`. The workflow is in `.github/workflows/deploy.yml`.

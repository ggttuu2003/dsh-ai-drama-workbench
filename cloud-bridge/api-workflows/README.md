# Raw ComfyUI API Exports

These files are for Bridge execution, not for drag-and-drop display in the
ComfyUI canvas. To inspect or edit the Z-Image image-to-image graph visually,
drag `../comfyui-workflows/z-image-turbo-image-to-image.json` into ComfyUI.
Files in `../workflows/` are Bridge contracts and also cannot be displayed as
canvas workflows.

Put each workflow exported through ComfyUI's **Save (API Format)** action in
this directory without editing it. These files are the canonical, user-owned
ComfyUI graphs.

The companion file in `../workflows/` only declares the safe Bridge contract:
which prompt, dimensions, seed, uploaded images, and final output node the
workbench may control. It never rewrites this raw export on disk.

For the current prompt-only image workflow:

```text
api-workflows/image-generate.api.json
workflows/image-generate.json
```

For the Z-Image Turbo image-to-image workflow used by first/last-frame image
generation:

```text
api-workflows/image-to-image.api.json
workflows/image-to-image.json
```

The Bridge injects the base image into `LoadImage` node `18` and an optional
second image into node `21`. When only one image is supplied, the contract
copies it to node `21`; the two `VAEEncode` outputs are combined by standard
ComfyUI `LatentBlend` node `24`. Width and height target both `ImageScale`
nodes (`19` and `22`), while denoise and seed target `KSampler` node `6`. The
graph follows ComfyUI's official `LoadImage -> VAEEncode -> KSampler`
image-to-image pattern:
https://comfyanonymous.github.io/ComfyUI_examples/img2img/

For the current MiniMax H3 first/last-frame video workflow:

```text
api-workflows/video-first-last.api.json
workflows/video-first-last.json
```

The export includes the two `LoadImage` nodes (`141` and `142`) and the
`SaveVideo` node (`92`). The companion contract replaces those two input image
names at run time and downloads only node `92`; it does not rewrite this file.
The duration override targets `140:133.value`, so the export's own
`duration -> 24 fps -> 17k+5` expression remains connected. Resolution and fps
stay controlled by the raw graph.

When a ComfyUI graph changes, export it again and replace only the matching
`api-workflows/*.api.json` file. Update the small mapping file only if one of
the mapped node IDs or input field names changed.

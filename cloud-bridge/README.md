# Comfy Bridge

`Comfy Bridge` is a small, standard-library-only service for the AI Drama
Workbench. It is intended to run on the same cloud server as ComfyUI.

When a workflow declares image inputs, the workbench uploads the selected local
assets, submits a fixed workflow preset, polls the job, then downloads only the
files recorded for that job. The `image-generate` workflow is prompt-only and
does not upload any image. The separate `image-to-image` workflow runs FLUX.2
Klein 4B with one or two explicitly selected reference images for first/last-frame
and scene image generation. Each reference uses an independent `ReferenceLatent`
conditioning path; the graph does not blend images or latents. The H3 video workflow uploads
the selected first and last frames to its two
`LoadImage` nodes, then downloads the final `SaveVideo` output.
The bridge does **not** expose ComfyUI directly to a browser and does not accept
arbitrary ComfyUI prompt graphs from callers.

## What this service provides

- `GET /health`
- `GET /workflows`
- `POST /uploads?name=<file-name>` for raw binary asset upload
- `POST /jobs` for a preset-backed image or video job
- `GET /jobs/<job-id>` for polling
- `GET /jobs/<job-id>/outputs/<file-name>` for a completed output download

Every endpoint requires `Authorization: Bearer <COMFY_BRIDGE_TOKEN>`. The
bridge has no CORS headers on purpose: call it from the local workbench backend,
not from a browser page.

## Quick start on the ComfyUI server

This service has no `pip`, Node.js, or database dependency. Python 3.9+ is
enough.

```sh
cd /opt
cp -R /path/to/dsh-ai-drama-workbench/cloud-bridge ./comfy-bridge
cd ./comfy-bridge
cp .env.example .env
chmod 600 .env
```

Edit `.env` before starting. At minimum, replace the token with a random value:

```sh
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Start in safe mock mode first:

```sh
./run.sh
```

The default address is `127.0.0.1:8787`. Keep it loopback-only and put Caddy,
Nginx, Tailscale, or an SSH tunnel in front of it. If you deliberately set
`COMFY_BRIDGE_BIND=0.0.0.0`, restrict the firewall to trusted clients and use
TLS at the reverse proxy.

To run it through systemd, copy `comfy-bridge.service.example` to
`/etc/systemd/system/comfy-bridge.service`, replace the service user and
`/opt/comfy-bridge` path, then run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now comfy-bridge
sudo systemctl status comfy-bridge
```

The workbench's **同步工作流** action is the update path for its built-in cloud
server connection. It deploys only `bridge.py`, `run.sh`, `workflows/*.json`,
and `api-workflows/*.json` to the fixed `/root/comfy-bridge` directory, then
restarts and verifies the bridge. Existing `.env`, `data/`, logs, uploads, and
job records are not copied or removed.

## Mock verification

Mock mode exercises the complete bridge contract without contacting ComfyUI. A
mock job writes a downloadable `dry-run.json` manifest rather than pretending
to create an image or video.

```sh
export COMFY_BRIDGE_TOKEN='the-long-token-from-dot-env'
curl -fsS \
  -H "Authorization: Bearer $COMFY_BRIDGE_TOKEN" \
  http://127.0.0.1:8787/health

curl -fsS \
  -H "Authorization: Bearer $COMFY_BRIDGE_TOKEN" \
  http://127.0.0.1:8787/workflows
```

Upload a selected frame as raw binary. The `name` query parameter is required;
path components are rejected.

```sh
curl -fsS -X POST \
  -H "Authorization: Bearer $COMFY_BRIDGE_TOKEN" \
  -H 'Content-Type: image/png' \
  --data-binary @./first-frame.png \
  'http://127.0.0.1:8787/uploads?name=first-frame.png'
```

The response shape is deliberately small and stable:

```json
{
  "uploadId": "upload_...",
  "fileName": "first-frame.png",
  "size": 12345,
  "sha256": "..."
}
```

Use the returned ID in a job. `image-generate`, `image-to-image`, and
`video-first-last` are workflow IDs; mock mode permits them so this request can
verify the integration before live execution is enabled.

```sh
curl -fsS -X POST \
  -H "Authorization: Bearer $COMFY_BRIDGE_TOKEN" \
  -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/jobs \
  --data '{
    "workflowId": "video-first-last",
    "clientJobId": "local-job-0001",
    "inputs": {
      "prompt": "A character turns toward camera",
      "seed": 42,
      "durationSeconds": 5
    },
    "uploads": [
      {"uploadId": "REPLACE_FIRST_UPLOAD_ID", "role": "firstFrame"},
      {"uploadId": "REPLACE_LAST_UPLOAD_ID", "role": "lastFrame"}
    ]
  }'
```

Poll the returned `id` until `status` is `completed`, then use an `outputs[].url`
value from that response. Reusing the same `clientJobId` returns the original
job instead of queuing a duplicate submission.

## Job contract

`POST /jobs` accepts only these top-level fields:

```json
{
  "workflowId": "image-generate",
  "clientJobId": "optional-local-id",
  "dryRun": false,
  "inputs": {
    "prompt": "...",
    "negativePrompt": "...",
    "width": 1024,
    "height": 1024,
    "seed": 42
  },
  "uploads": []
}
```

The exact accepted input names and upload roles come from `GET /workflows`.
The current `image-generate` graph accepts `prompt`, `negativePrompt`, `width`,
`height`, and `seed`; it is the user's prompt-only export and declares no image
uploads. The FLUX.2 Klein 4B `image-to-image` graph accepts `prompt`, `width`,
`height`, and `seed`, and requires one `referenceImage` upload; `referenceImage2`
is optional and falls back to the first image. It has no negative-prompt or
denoise input. The current H3 video graph
accepts `prompt`, `seed`, and `durationSeconds`, and requires `firstFrame` plus
`lastFrame` uploads. Its raw
graph retains ownership of resolution, 24 fps output, and the `17k+5` frame
alignment expression.

`GET /jobs/<job-id>` and `POST /jobs` return a job object with these fields:

```json
{
  "id": "job_...",
  "status": "queued",
  "progress": {"phase": "queued", "value": 0, "message": "..."},
  "outputs": [
    {
      "fileName": "01-output.mp4",
      "contentType": "video/mp4",
      "size": 123456,
      "sha256": "...",
      "url": "/jobs/job_.../outputs/01-output.mp4"
    }
  ]
}
```

Possible statuses are `queued`, `uploading`, `running`, `downloading`,
`completed`, `failed`, and `interrupted`. Active jobs are marked `interrupted`
if this process restarts; submit a new job instead of resuming the failed record.

## Installing a real workflow

The files in `workflows/` are small Bridge contracts. The enabled text-to-image,
image-to-image, and H3 video contracts point to the raw exports in
`api-workflows/`; the raw exports
remain the canonical graphs you maintain in ComfyUI. A real ComfyUI API export
and its Bridge contract deliberately live in separate files, so the Bridge never
becomes a hand-edited fork of the workflow you maintain in ComfyUI.

For each real image or video workflow:

1. Run it manually in the target ComfyUI installation.
2. Export it using ComfyUI's **Save (API Format)** action.
3. Copy that export unchanged into `api-workflows/`, for example
   `api-workflows/image-generate.api.json`. This is the canonical graph you own
   and continue to edit through ComfyUI.
4. Copy or update the matching small contract in `workflows/<preset>.json`, then
   set its `comfyPromptFile` to the raw export file name. Keep the stable preset
   ID (`image-generate`, `image-to-image`, or `video-first-last`); do not put a copy of the graph
   inside the mapping file.
5. Update `inputMappings` and `uploadMappings` to the exact node ID and input
   field that should be caller-controlled. Keep model choice, LoRAs, sampler
   graph, and output nodes fixed in the preset.
6. Keep `outputNodeIds` limited to the exact final save/output nodes for this
   preset. Their order becomes the stable output-file order. Preview images,
   debug saves, and intermediate videos must not be listed there; the bridge
   downloads only these declared nodes and only files that match the workflow
   kind.
7. Set `enabled` to `true`, validate with `COMFY_BRIDGE_MODE=mock` or a request
   containing `"dryRun": true`, then change `COMFY_BRIDGE_MODE=live`.
8. Restart the bridge and confirm `GET /workflows` reports the intended mapping.

When you later change the ComfyUI graph, replace only its original
`api-workflows/*.api.json` export. The Bridge mapping does not need any change
unless a mapped node ID, input field, or final save node changed.

An input mapping has this form:

```json
"seed": {
  "nodeId": "5",
  "field": "seed",
  "type": "integer",
  "max": 2147483647
}
```

An uploaded asset mapping has this form:

```json
"firstFrame": {
  "nodeId": "10",
  "field": "image",
  "required": true,
  "acceptedExtensions": [".png", ".jpg", ".jpeg", ".webp"]
}
```

An optional second image and a fan-out input mapping can be declared like this:

```json
"referenceImage2": {
  "nodeId": "21",
  "field": "image",
  "required": false,
  "fallbackRole": "referenceImage",
  "acceptedExtensions": [".png", ".jpg", ".jpeg", ".webp"]
}
```

`targets` is an optional list on an input or upload mapping when the same value
must be written to multiple ComfyUI fields. Every target must exist in the raw
API graph. The shipped FLUX.2 reference-generation graph uses ComfyUI's
`ReferenceLatent` conditioning and requires the UNet, text encoder, and VAE
files referenced by the raw export.

The bridge injects only these declared fields. It uploads input images to the
local ComfyUI `/upload/image` endpoint, submits the preset through `/prompt`,
polls `/history/<prompt-id>`, and downloads only reported `type=output` files
through `/view`. Depending on the ComfyUI version, a `SaveVideo` result may be
reported under `images` rather than `videos`; the bridge accepts it only when
the filename has a video extension and the node is explicitly listed in
`outputNodeIds`.

## Security model

- A non-placeholder bearer token of at least 24 characters is required at boot.
- Token comparison is constant-time and every route, including health, requires it.
- `COMFYUI_URL` rejects non-loopback hosts and loopback names that resolve to a
  non-loopback address. ComfyUI must not be exposed as a public `:8188` service.
- The caller cannot choose node classes, model paths, output paths, or URLs.
- Only administrator-declared `outputNodeIds` are downloaded; preview or
  intermediate output nodes are ignored, and files with the wrong media type
  for an image/video preset are rejected before they reach the project.
- Upload file names cannot contain paths. Output downloads are limited to files
  that the bridge itself recorded for the requested job.
- Workflow JSON is administrator-controlled code-like configuration. Do not let
  an untrusted user edit `workflows/*.json`.
- `data/` contains uploaded source assets and job metadata. Keep it on encrypted
  server storage when source material is sensitive, and back it up or prune it
  according to your project policy.

## Tests

Run the stdlib integration test without ComfyUI:

```sh
python3 -m unittest discover -s . -p 'test_*.py' -v
```

# Install OpenAI PS in Photoshop

This repository now contains a minimal Adobe Photoshop UXP plugin at the repository root.

## Requirements

- Adobe Photoshop 2021 or newer
- Adobe UXP Developer Tool
- An OpenAI API key with image generation access

## Load the plugin

1. Open Photoshop.
2. Create or open a document.
3. Open Adobe UXP Developer Tool.
4. Click `Add Plugin`.
5. Select this file:

   `D:\Documents\AI资源\AI应用\vibe-coding\OpenAI-PS\manifest.json`

6. Select `OpenAI PS` in UXP Developer Tool.
7. Click `Load`.
8. In Photoshop, open `Plugins > OpenAI PS`.

## Use the panel

1. Set `Base URL`.
   - Current local default: `https://sub.love-gwen.top`
   - Official OpenAI: `https://api.openai.com/v1`
   - OpenAI-compatible gateway: use either the root URL, the `/v1` base URL, or a full known image endpoint.
2. Set `Endpoint`.
   - Default: `/v1/images/generations`
3. Set `Model`.
   - Current local default: `gpt-image-2`
   - Official OpenAI default: `gpt-image-1`
   - Third-party providers may use names like `dall-e-3`, `flux`, `gpt-image-2`, or provider-specific image model IDs.
4. Paste your API key.
5. Optionally enable `Remember locally`.
6. Type an image prompt.
7. Pick size, quality, and background.
8. Add provider-specific request fields in `Extra JSON` if needed.
9. Click `Generate Layer`.

The plugin calls the configured image generation endpoint, reads either `data[0].b64_json` or `data[0].url`, writes the image into the plugin data folder, and places it into the active Photoshop document as a new layer.

## Notes

- Keep a Photoshop document open before clicking `Generate Layer`.
- Photoshop 2021 uses UXP manifest v4, so this plugin is authored with `manifestVersion: 4`.
- The API key is stored in UXP local storage only when `Remember locally` is checked.
- Provider Base URL, Endpoint, and Model are stored only when `Remember locally` is checked.
- Higher quality settings cost more and take longer.
- This is a minimal working plugin, not a signed packaged marketplace plugin.

# directus-jasmeralia

Directus + Astro stack for jasmeralia.com. This folder contains:

- `builder/`: webhook receiver + build/publish scripts for Astro
- `site/`: Astro project source (static build)
- `docker-compose.yml`: local/TrueNAS stack definition (if present)
- `CHANGELOG.md`: change log for Astro project changes

## Notes
- Directus is private (not exposed publicly).
- Static site is built in the builder container and published to S3/CloudFront.
- See `.chatgpt_context.md` in `/mnt/myzmirror/myzdset/morgan/directus` for operational context.

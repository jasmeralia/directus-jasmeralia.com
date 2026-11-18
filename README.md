# jasmeralia.com-directus

[Directus](https://directus.io/) + [Astro](https://astro.build/) stack for https://jasmeralia.com. The public repository owns the CMS deployment, static site, and site builder. Private game-library maintenance scripts live in `jasmeralia.com-mcp-scripts`.

- `builder/`: webhook receiver + build/publish scripts for Astro
- `site/`: Astro project source (static build)
- `docker-compose.yml`: local/TrueNAS stack definition (if present)
- `CHANGELOG.md`: change log for Astro project changes
- `mcp/plans/` and `mcp/reports/`: retained design notes and review artifacts

## Notes
- Directus is private (not exposed publicly).
- Static site is built in the builder container and published to S3/CloudFront.

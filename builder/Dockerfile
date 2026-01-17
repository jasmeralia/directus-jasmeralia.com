# Builder + webhook receiver
# - Listens on :8099 for POST /build with header X-Webhook-Secret: <secret>
# - Debounces build requests
# - Runs Astro build, syncs dist/ to S3 bucket root, optionally invalidates CloudFront

FROM node:20-alpine

# Needed for aws s3 sync + cloudfront invalidation
RUN apk add --no-cache bash curl aws-cli

WORKDIR /srv

COPY server.js /srv/server.js
COPY run-build.sh /srv/run-build.sh
RUN chmod +x /srv/run-build.sh

ENV PORT=8099
EXPOSE 8099

CMD ["node", "/srv/server.js"]

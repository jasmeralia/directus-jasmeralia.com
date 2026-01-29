# Builder + webhook receiver
# - Listens on :8099 for POST /build with header X-Webhook-Secret: <secret>
# - Debounces build requests
# - Runs Astro build, syncs dist/ to S3 bucket root, optionally invalidates CloudFront

FROM node:20-slim

# Needed for aws s3 sync + cloudfront invalidation
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash curl unzip ca-certificates \
  && curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip" \
  && unzip /tmp/awscliv2.zip -d /tmp \
  && /tmp/aws/install \
  && rm -rf /var/lib/apt/lists/* /tmp/aws /tmp/awscliv2.zip

# Pin npm to avoid lockfile format mismatches.
RUN npm install -g npm@11.8.0

WORKDIR /srv

COPY server.js /srv/server.js
COPY run-build.sh /srv/run-build.sh
RUN chmod +x /srv/run-build.sh

ENV PORT=8099
EXPOSE 8099

CMD ["node", "/srv/server.js"]

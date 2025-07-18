# Docs for base image: https://github.com/nodejs/docker-node
FROM node:22

# Install stuff we'll always or usually need for running builds, so we don't
# need to redo this for every package.
# Note the cleanup at the end is recommended by
# https://docs.docker.com/build/building/best-practices/#run
RUN apt-get update && apt-get install -y \
    # Needed for the build process of React:
    default-jre \
    && rm -rf /var/lib/apt/lists/*

# Update to the latest version of npm so npm won't nag us to do so later.
# (Fails if run as non-root.)
RUN npm install -g npm@latest

# These base images come with a non-root `node` user. We use that user for
# builds just in case we need to use any tools that freak out about being run
# as root (and because it has a clean home directory e can work in).
USER node
WORKDIR /home/node

# Folder we use to share one of two things with the host:
# 1. the built and packed tarball, if the build succeeds, or
# 2. a structured error, if the build fails
RUN mkdir -p /home/node/build
# TODO: Why do we have to do this next bit? Does it even have an effect? I am
#       cargo-culting based on what Claude generated for me, but don't know
#       what this is actually for.
VOLUME ["/home/node/build"]

# Copy in the script we want the container to run:
COPY buildPackage.js /home/node/buildPackage.js

# Make the script the default command.
# This expects two arguments - a repo path and a version number
ENTRYPOINT ["node", "/home/node/buildPackage.js"]

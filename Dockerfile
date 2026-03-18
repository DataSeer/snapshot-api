# Use Node.js 20 as the base image
FROM node:20.18.0

# Set the working directory in the container
WORKDIR /usr/src/app

# Install build tools for native addons
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install project dependencies (build native addons from source for glibc compatibility)
RUN npm install --build-from-source

# Copy project files and folders to the current working directory (i.e. 'app' folder)
# This will exclude .env and all configuration files
COPY . .

# Copy default files if originals don't exist
RUN if [ ! -f .env ]; then cp .env.default .env || true; fi && \
    if [ ! -f conf/aws.s3.json ]; then mkdir -p conf && cp conf/aws.s3.json.default conf/aws.s3.json || true; fi && \
    if [ ! -f conf/em.json ]; then mkdir -p conf && cp conf/em.json.default conf/em.json || true; fi && \
    if [ ! -f conf/datastet.json ]; then mkdir -p conf && cp conf/datastet.json.default conf/datastet.json || true; fi && \
    if [ ! -f conf/genshare.json ]; then mkdir -p conf && cp conf/genshare.json.default conf/genshare.json || true; fi && \
    if [ ! -f conf/googleSheets.credentials.json ]; then mkdir -p conf && cp conf/googleSheets.credentials.json.default conf/googleSheets.credentials.json || true; fi && \
    if [ ! -f conf/googleSheets.json ]; then mkdir -p conf && cp conf/googleSheets.json.default conf/googleSheets.json || true; fi && \
    if [ ! -f conf/grobid.json ]; then mkdir -p conf && cp conf/grobid.json.default conf/grobid.json || true; fi && \
    if [ ! -f conf/queueManager.json ]; then mkdir -p conf && cp conf/queueManager.json.default conf/queueManager.json || true; fi && \
    if [ ! -f conf/reports.json ]; then mkdir -p conf && cp conf/reports.json.default conf/reports.json || true; fi && \
    if [ ! -f conf/permissions.json ]; then mkdir -p conf && cp conf/permissions.json.default conf/permissions.json || true; fi && \
    if [ ! -f conf/users.json ]; then mkdir -p conf && cp conf/users.json.default conf/users.json || true; fi

# Expose the port your app runs on
EXPOSE 3000

# Define the command to run your app
CMD [ "node", "src/server.js" ]
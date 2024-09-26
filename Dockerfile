# Use Node.js 16 as the base image
FROM node:16

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy project files and folders to the current working directory (i.e. 'app' folder)
# This will exclude .env, conf/users.json, and conf/genshare.json
COPY . .

# Copy default files if originals don't exist
RUN if [ ! -f .env ]; then cp .env.default .env || true; fi && \
    if [ ! -f conf/users.json ]; then mkdir -p conf && cp conf/users.json.default conf/users.json || true; fi && \
    if [ ! -f conf/genshare.json ]; then mkdir -p conf && cp conf/genshare.json.default conf/genshare.json || true; fi

# Expose the port your app runs on
EXPOSE 3000

# Define the command to run your app
CMD [ "node", "src/server.js" ]
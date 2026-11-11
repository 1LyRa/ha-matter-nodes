FROM node:22-alpine

# Install build dependencies for native modules if required (e.g. python, make, g++)
RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app

# Copy package descriptors
COPY package.json ./

# Install npm dependencies
RUN npm install --omit=dev

# Copy source files
COPY src/ ./src/
COPY run.sh /run.sh

RUN chmod +x /run.sh

EXPOSE 8099
# UDP ports 5541+ will be open via host_network: true

CMD [ "/run.sh" ]

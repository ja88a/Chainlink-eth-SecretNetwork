FROM node:12 as builder
ARG module
ARG name
WORKDIR /home/node/app

COPY . .
RUN make deps
RUN make build

FROM node:12-alpine
ARG module
EXPOSE 8080
WORKDIR /home/node/app

COPY --from=builder /home/node/app/$module/dist ./
COPY --from=builder /home/node/app/$module/package.json ./

CMD ["yarn", "server"]

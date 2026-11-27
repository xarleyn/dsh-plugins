const read = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
} as const;

const collectionRead = { ...read, requiresResourceBoundary: true } as const;

export const DIRECTUS_OPERATIONS = {
  "connection.get": {
    capability: "items.read",
    security: read,
    path: "/users/me",
  },
  "collections.list": { capability: "items.read", security: collectionRead },
  "items.list": {
    capability: "items.read",
    security: collectionRead,
    path: "/items/{collection}",
  },
  "items.count": {
    capability: "items.read",
    security: collectionRead,
    path: "/items/{collection}",
  },
  "items.get": {
    capability: "items.read",
    security: collectionRead,
    path: "/items/{collection}/{id}",
  },
  "files.get": {
    capability: "files.read",
    security: collectionRead,
    path: "/files/{id}",
  },
} as const;

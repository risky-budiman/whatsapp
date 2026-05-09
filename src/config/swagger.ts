import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'WhatsApp Gateway API',
      version: '1.0.0',
      description: 'API Documentation for WhatsApp Broadcasting Gateway with Anti-Ban System',
      contact: {
        name: 'Developer',
      },
    },
    servers: [
      {
        url: `http://localhost:${env.APP_PORT || 3100}`,
        description: 'Local server',
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
      },
    },
    security: [
      {
        ApiKeyAuth: [],
      },
    ],
  },
  apis: [
    `${process.cwd()}/src/api/routes/*.ts`,
    `${process.cwd()}/src/index.ts`,
  ],
};

export const swaggerSpec = swaggerJsdoc(options);

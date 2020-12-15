// const { Middleware } = require('swagger-express-middleware');
const http = require('http');
const fs = require('fs');
const path = require('path');
const swaggerUI = require('swagger-ui-express');
const jsYaml = require('js-yaml');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const { OpenApiValidator } = require('express-openapi-validator');
const logger = require('./logger');
const timeout = require('connect-timeout');
const config = require('./config');
const mainnet = require("mainnet-js");

const makeWsServer = require('./wsServer');

class ExpressServer {
  constructor(port, openApiYaml, docYaml) {
    this.port = port;
    this.app = express();
    this.openApiPath = openApiYaml;
    this.docPath = docYaml;
    try {
      this.schema = jsYaml.safeLoad(fs.readFileSync(openApiYaml));
      this.docSchema = jsYaml.safeLoad(fs.readFileSync(docYaml).toString());
    } catch (e) {
      logger.error('failed to start Express Server', e.message);
    }
    this.setupMiddleware();
  }

  setupMiddleware() {
    // this.setupAllowedMedia();
    this.app.use(cors());
    this.app.use(bodyParser.json({ limit: '15MB' }));
    this.app.use(express.json());
    this.app.use(timeout(`${config.TIMEOUT}s`));
    this.app.use(express.urlencoded({ extended: false }));
    //this.app.use(cookieParser());
    //Simple test to see that the server is up and responding
    this.app.get("/ready", (req, res) => {
      res.status(200);
      res.json({ "status": "okay" });
    });
    //Send the openapi document *AS GENERATED BY THE GENERATOR*
    this.app.get('/openapi', (req, res) => res.sendFile((path.join(__dirname, "../../swagger/v1/", "api.yml"))));
    //View the openapi document in a visual interface. Should be able to test from this page
    this.app.get('/', (req, res) => {
      res.redirect(301, '/api-docs');
    });

    this.app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(this.docSchema));
    this.app.get("/timeout", (req, res) => {});
    this.app.get('/login-redirect', (req, res) => {
      res.status(200);
      res.json(req.query);
    });
    this.app.get('/oauth2-redirect.html', (req, res) => {
      res.status(200);
      res.json(req.query);
    });
  }

  async launch() {
    return new OpenApiValidator({
      apiSpec: this.openApiPath,
      operationHandlers: path.join(__dirname),
      fileUploader: { dest: config.FILE_UPLOAD_PATH },
    }).install(this.app)
      .catch(e => console.log(e))
      .then(async () => {
        // eslint-disable-next-line no-unused-vars
        this.app.use((err, req, res, next) => {
          // format errors
          res.status(err.status || 500).json({
            message: err.message || err.error,
            errors: err.errors || '',
          });
        });
        await mainnet.initProviders()
        const server = this.app.listen(this.port);
        const wsServer = makeWsServer(server);
        server.on('upgrade', (request, socket, head) => {
          wsServer.handleUpgrade(request, socket, head, socket => {
            wsServer.emit('connection', socket, request);
          });
        });

        return server;
      });
  }

  async close() {
    await mainnet.disconnectProviders();
    if (this.server !== undefined) {
      await this.server.close();
      console.log(`Server on port ${this.port} shut down`);
    }
  }
}

module.exports = ExpressServer;

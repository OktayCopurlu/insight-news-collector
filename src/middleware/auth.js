import dotenv from "dotenv";
import { createContextLogger } from "../config/logger.js";

dotenv.config();

const _logger = createContextLogger("AuthMiddleware");

export const optionalAuth = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token) {
    const expectedToken = process.env.EDGE_TOKEN;

    if (expectedToken && token === expectedToken) {
      req.authenticated = true;
    } else {
      req.authenticated = false;
    }
  } else {
    req.authenticated = false;
  }

  next();
};

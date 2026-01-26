const { verifyToken } = require('../utils/jwtHelper');
const { unauthorizedResponse } = require('../utils/responseHelper');

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return unauthorizedResponse(res, 'No token provided');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return unauthorizedResponse(res, 'Invalid or expired token');
    }

    // Attach user to request
    req.user = decoded;
    
    next();
  } catch (error) {
    return unauthorizedResponse(res, 'Authentication failed');
  }
};

module.exports = authMiddleware;
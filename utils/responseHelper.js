const getTimestamp = () => {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
};

const successResponse = (res, message, data = {}, statusCode = 200, includeTimestamp = false) => {
  const response = {
    success: true,
    message,
    data
  };

  if (includeTimestamp) {
    response.timestamp = getTimestamp();
  }

  return res.status(statusCode).json(response);
};

const errorResponse = (res, message, statusCode = 400, errors = null, includeTimestamp = false) => {
  const response = {
    success: false,
    message
  };

  if (errors) {
    response.errors = errors;
  }

  if (includeTimestamp) {
    response.timestamp = getTimestamp();
  }

  return res.status(statusCode).json(response);
};

const validationErrorResponse = (res, errors) => {
  return errorResponse(res, 'Validation failed', 422, errors);
};

const unauthorizedResponse = (res, message = 'Unauthorized access') => {
  return errorResponse(res, message, 401);
};

const notFoundResponse = (res, message = 'Resource not found') => {
  return errorResponse(res, message, 404);
};

module.exports = {
  successResponse,
  errorResponse,
  validationErrorResponse,
  unauthorizedResponse,
  notFoundResponse,
  getTimestamp
};
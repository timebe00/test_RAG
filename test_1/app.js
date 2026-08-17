var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var helmet = require('helmet');
var cors = require('cors');
var rateLimit = require('express-rate-limit');

global.base = __dirname;
global.config = require(base + '/config/config.json');

var app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

var securityConfig = global.config.security || {};
var corsConfig = securityConfig.cors || {};
var helmetConfig = securityConfig.helmet || {};
var rateLimitConfig = securityConfig.rateLimit || {};
var generalRateLimitConfig = rateLimitConfig.general || {};
var webhookRateLimitConfig = rateLimitConfig.webhook || {};

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(helmet(helmetConfig));

if (corsConfig.enabled && Array.isArray(corsConfig.origins) && corsConfig.origins.length > 0) {
  app.use(cors({
    origin: corsConfig.origins,
    credentials: corsConfig.credentials !== false,
  }));
}

app.use(express.json({ limit: securityConfig.bodyLimit || '1mb' }));
app.use(express.urlencoded({ extended: false, limit: securityConfig.bodyLimit || '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

var generalLimiter = rateLimit({
  windowMs: generalRateLimitConfig.windowMs || 15 * 60 * 1000,
  max: generalRateLimitConfig.max || 100,
  standardHeaders: true,
  legacyHeaders: false,
});

var webhookLimiter = rateLimit({
  windowMs: webhookRateLimitConfig.windowMs || 1 * 60 * 1000,
  max: webhookRateLimitConfig.max || 60,
  standardHeaders: true,
  legacyHeaders: false,
});

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var databaseRouter = require('./routes/database');

app.use('/user', generalLimiter);
app.use('/telegram/webhook', webhookLimiter);

app.use('/', indexRouter);
app.use('/user', usersRouter);
app.use('/db', databaseRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};



  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;

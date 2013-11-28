
var cql = require('cql-protocol');
var async = require('async');

var Connection = require('./connection');
var types = require('./types');
var events = require('events');
var util = require('util');

var CONSISTENCY_LEVELS = {
  any: cql.CL.ANY,
  one: cql.CL.ONE,
  two: cql.CL.TWO,
  three: cql.CL.THREE,
  quorum: cql.CL.QUORUM,
  all: cql.CL.ALL,
  local_quorum: cql.CL.LOCAL_QUORUM,
  each_quorum: cql.CL_EACH_QUORUM
};

/**
 * Create client
 * @param {object} option - optional parameters
 * @param {array} option.hosts - seed hosts to connect to get peers. ex) [127.0.0.1:9402,127.0.0.2:9042,.. ]
 * @param {string=} option.consistencyLevel - default consistency level (one,two,three,quorum,local_quorum,each_quorum,all,any). default is quorum.
 * @param {number=} option.connsPerHost - number of connections to be used per hosts. default is 2
 * @param {number=} option.reconnectInterval - interval milliseconds for waiting next attemp to reconnect
 * @param {number=} option.protocolVersion - native protocol version. default is 2
 * @param {number=} option.maxWaitPerConns - maximum number of request to be accepted per connection
 *
 */
function Client(option) {

  option = option || {};

  // seed hosts
  var hosts = option.hosts || option.host;
  if (!hosts || hosts.length === 0) {
    throw new Error('`hosts` required to create client');
  }

  if (typeof hosts === 'string') {
    hosts = [hosts];
  }

  this._seeds = hosts;
  this._conns = [];
  this._connsPerHost = option.connsPerHost || 2;
  this._connectRoundRobin = 0;
  this._connectWaitQueue = [];
  this._reconnectInterval = option.reconnectInterval || 5000;
  this._keyspace = option.keyspace;

  this._protocolVersion = option.protocolVersion || 2;
  // set default consistency level
  var cl = (option.cl || option.consistencyLevel || 'quorum').toLowerCase();
  if (cl in CONSISTENCY_LEVELS) {
    this._consistencyLevel = CONSISTENCY_LEVELS[cl];
  } else {
    throw new Error('Invalid consistency level ' + cl);
  }
  this._maxWaitPerConns = option.maxWaitPerConns || 100;

  // auto connect to seed
  setImmediate(this.connect.bind(this));
}

util.inherits(Client, events.EventEmitter);

/**
 * Connect to seed host
 */
Client.prototype.connect = function() {

  var seedHosts = this._seeds.slice();
  var seedConn = null;
  var self = this;

  // trying to connect to seed host
  async.whilst(function() {
    return seedConn === null;
  }, function(callback) {
    if (seedHosts.length === 0) {
      return callback(new Error('Unavailable seed hosts'));
    }
    var host = seedHosts.shift();
    self.emit('log', 'info', 'Connecting to seed host ' + host);

    var conn = self.createConnection(host);
    conn.connect(function(err) {
      if (err) {
        self.emit('log', 'error', err);
      } else {
        seedConn = conn;
      }
      callback();
    });
  }, function(err) {
    if (err) {
      self.emit('log', 'info', 'Seed unavailable. Wait for reconnect');
    } else {
      self.connectPeers(seedConn);
    }
  });
};

/**
 * Get peers and create connections to peers
 * @param {object} seedConn - seed connection
 */
Client.prototype.connectPeers = function(seedConn) {
  var self = this;
  this.emit('log', 'debug', 'Get peers');
  seedConn.query('SELECT peer FROM system.peers', function(err, rs) {
    if (err) {
      self.emit('error', err);
      return;
    }
    var connsPerHost = self._connsPerHost;
    var connections = [seedConn];
    var rows = rs.rows, i;
    for (i = 0; i < connsPerHost - 1; i++) {
      rows.push({ peer: seedConn._host });
    }

    // make ready when at least 5 or 1/3 connections are available
    var readyThreshold = Math.min(5, Math.floor((rows.length * connsPerHost) / 3) + 1);
    var readyCount = 0;
    var readyCheck = function(err) {
      if (!err) {
        if (++readyCount >= readyThreshold) {
          if (ready) {
            ready();
            ready = null;
          }
        }
      }
    };

    self.emit('log', 'debug', 'Wait until ' + readyThreshold + ' connections available');

    var ready = function() {
      self.emit('log', 'debug', 'Enough connections are avaialble to use client' + readyThreshold);
      self.emit('ready');
      self._ready = true;
      self._connectWaitQueue.forEach(function(callback) {
        try {
          self.getAvailableConnection(callback);
        } catch (e) {
          self.emit('error', e);
        }
      });
      self._connectWaitQueue = [];
    };
    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      for (var j = 0; j < connsPerHost; j++) {
        var conn = self.createConnection(row.peer);
        connections.push(conn);
        conn.connect(readyCheck);
      }
    }
    self._conns = connections;
    if (rows.length === 0) {
      setImmediate(ready);
    }
  });
};

/**
 * Close all connections
 */
Client.prototype.close = function() {
  // close active connecitons
  this._conns.forEach(function(conn) {
    if (conn._active && !conn._shutdown) {
      conn.close();
    }
  });
};

/**
 * Create connection with default parameters
 * @param {string} host - host name or address
 */
Client.prototype.createConnection = function(host) {
  var conn = new Connection({
    host: host,
    consistencyLevel: this._consistencyLevel,
    maxWaitPerConns: this._maxWaitPerConns,
    keyspace: this._keyspace,
    autoReconnect: true
  });
  // bind events
  conn.on('close', this.emit.bind(this, 'log', 'info', 'cassandra connection closed from ' + host));
  conn.on('connect', this.emit.bind(this, 'log', 'debug', 'connected to cassandra ' + host));
  conn.on('reconnecting', this.emit.bind(this, 'log', 'debug', 'reconnecting to host ' + host));
  conn.on('error', this.emit.bind(this, 'error'));
  return conn;
};

/**
 * Get available connection to execute queries.
 */
Client.prototype.getAvailableConnection = function(callback) {
  if (!this._ready) {
    this._connectWaitQueue.push(callback);
    return;
  }
  var left = this._conns.length;
  while (left > 0) {
    var next = this._connectRoundRobin++;
    if (next >= this._conns.length) {
      next = 0;
    }
    var conn = this._conns[next];
    if (conn._active) {
      callback(null, conn);
      return;
    }
  }
  callback(new Error('No active connections'));
};

/**
 * Execute query. Client will use prepared query if values specified.
 * @param {string} query - query
 * @param {array=} values - bound values
 * @param {object=} options - optional parameters
 * @param {function} callback - call back query result
 */
Client.prototype.execute = function(query, values, options, callback) {

  // adjust arguments
  if (arguments.length === 2) {
    callback = values;
    values = null;
    options = {};
  } else if (arguments.length === 3) {
    callback = options;
    if (Array.isArray(values)) {
      options = {};
    } else {
      options = values;
      values = null;
    }
  }

  var self = this;

  this.getAvailableConnection(function(err, conn) {
    if (err) {
      return callback(err);
    }
    if (values) {
      conn.prepare(query, function(err, prepared) {
        if (err) {
          return callback(err);
        }

        var metadata = prepared.metadata;
        var specs = metadata.columnSpecs;

        for (var i = 0; i < specs.length; i++) {
          var value = values[i];
          if (value !== null) {
            var spec = specs[i];
            var type = types.fromType(spec.type);
            values[i] = type.serialize(value);
          }
        }

        conn.execute(prepared.id, values, options, function(err, rs) {
          if (err && err.code === 0x2500) {
            // if query expired, unprepare and retry
            conn.unprepare(query);
            // retry execution
            self.execute(query, values, options, callback);
          } else {
            callback(err, rs);
          }
        });
      });
    } else {
      conn.query(query, options, callback);
    }
  });
};

Client.prototype.batch = function() {
};

module.exports = Client;
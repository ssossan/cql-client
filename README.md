cql-client
==========

[![Build Status](https://travis-ci.org/suguru/cql-client.png)](https://travis-ci.org/suguru/cql-client)

Node.js driver for cassandra. The driver uses Cassandra Binary Protocol v2.

**NOTICE** This module is *NOT* ready for production use yet.

Features
----------

- CQL binary protocol v2
- Auto detection for cluster peers
- Auto reconnecting connections
- Listening events from cassandra
- Paging large result set

Quick start
----------

```js
var client = require('cql-client').createClient({
  hosts: ['127.0.0.1']
});

client.execute('SELECT * FROM system.peers', function(err, rs) {
  var rows = rs.rows;
  ..
});
```

Usage
----------

TODO
----------

- Batch
- Result paging
- Authentication

License
----------

See [LICENSE](LICENSE)

Copyright (C) Suguru Namura

[cql-protocol]: <https://github.com/yukim/cql-protocol/>

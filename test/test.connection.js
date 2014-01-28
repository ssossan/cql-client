/* global describe,it,beforeEach,afterEach */

var Connection = require('../lib/connection');
var expect = require('expect.js');
var uuid = require('node-uuid');
var types = require('../lib/protocol/types');

describe('Connection', function() {

  var conn;

  beforeEach(function(done) {
    conn = new Connection({
      reconnectInterval: 500
    });
    conn.connect();
    conn.once('connect', done);
  });

  beforeEach(function(done) {
    conn.query('drop keyspace if exists cql_client', done);
  });

  beforeEach(function(done) {
    conn.query("create keyspace cql_client with replication={'class':'SimpleStrategy','replication_factor':1}", function(err, result) {
      if (err) {
        return done(err);
      }
      var schema = result.schema;
      expect(schema.change).to.eql('CREATED');
      expect(schema.keyspace).to.eql('cql_client');
      expect(schema).to.be.ok();
      done();
    });
  });

  beforeEach(function(done) {
    conn.query("use cql_client", done);
  });

  beforeEach(function(done) {
    conn.query('drop table if exists table1', done);
  });

  beforeEach(function(done) {
    conn.query('create table table1 (id uuid, value1 text, value2 int, primary key (id))', function(err, result) {
      if (err) {
        return done(err);
      }
      var schema = result.schema;
      expect(schema.change).to.eql('CREATED');
      expect(schema.keyspace).to.eql('cql_client');
      expect(schema.table).to.eql('table1');
      done();
    });
  });

  afterEach(function(done) {
    conn.close(done);
  });

  var findRow = function(rs, id) {
    for (var i = 0; i < rs.rows.length; i++) {
      var row = rs.rows[i];
      if (row.id === id) {
        return row;
      }
    }
    return null;
  };

  describe('#connect', function() {

    it('should connected to the server', function(done) {
      expect(conn).to.be.ok();
      done();
    });

    it('should auto reconnect to the server', function(done) {
      conn.setAutoReconnect(true);
      conn.once('reconnecting', function() {
        conn.once('connect', done);
      });
      // force close to simulate auto reconnect
      conn._socket.end();
    });

    it('should throw error if connect twice', function(done) {
      try {
        conn.connect();
      } catch (e) {
        done();
      }
    });

    it('should close twice', function(done) {
      conn.setAutoReconnect(false);
      conn.close(function() {
        conn.close(function() {
          conn.connect(done);
        });
      });
    });

    it('should emit error when socket emits error', function(done) {
      conn.on('error', function(err) {
        expect(err).to.be.ok();
        expect(err.message).to.eql('No way');
        done();
      });
      conn._socket.emit('error', new Error('No way'));
      conn._socket.destroy();
    });

  });

  describe('#query', function() {

    it('should have keyspace', function(done) {
      conn.query("select * from system.schema_keyspaces where keyspace_name='cql_client'", function(err, result) {
        if (err) {
          return done(err);
        }
        var rs = result.resultSet;
        expect(rs).to.be.ok();
        expect(rs.rows).to.have.length(1);
        expect(rs.rows[0].keyspace_name).to.eql('cql_client');
        expect(rs.rows[0].durable_writes).to.eql(true);
        expect(rs.rows[0].strategy_class).to.eql('org.apache.cassandra.locator.SimpleStrategy');
        done();
      });
    });

    it('should insert data', function(done) {
      conn.query("insert into table1 (id, value1, value2) values (acec5f5e-7ce2-4e8d-94bb-a00ecd7bf428, 'value-text', 100)", function(err) {
        if (err) {
          return done(err);
        }
        conn.query('select id, value1, value2 from table1 where id = acec5f5e-7ce2-4e8d-94bb-a00ecd7bf428', function(err, result) {
          if (err) {
            return done(err);
          }
          var rs = result.resultSet;
          expect(rs.rows).to.have.length(1);
          expect(rs.rows[0]).to.eql({
            id: 'acec5f5e-7ce2-4e8d-94bb-a00ecd7bf428',
            value1: 'value-text',
            value2: 100
          });
          done();
        });
      });
    });

    it('should update data', function(done) {
      conn.query("update table1 set value1 = 'update-value' where id = fca19434-620e-4dbd-ac0c-6fd3c9350a2a", function(err) {
        if (err) {
          return done(err);
        }
        conn.query("select id, value1, value2 from table1 where id = fca19434-620e-4dbd-ac0c-6fd3c9350a2a", function(err, result) {
          if (err) {
            return done(err);
          }
          var rs = result.resultSet;
          expect(rs.rows).to.have.length(1);
          expect(rs.rows[0]).to.eql({
            id: 'fca19434-620e-4dbd-ac0c-6fd3c9350a2a',
            value1: 'update-value',
            value2: null
          });
          done();
        });
      });
    });

    it('should delete data', function(done) {
      conn.query("insert into table1 (id, value1, value2) values (acec5f5e-7ce2-4e8d-94bb-a00ecd7bf428, 'value-text', 100)", function(err) {
        if (err) {
          return done(err);
        }
        conn.query('select id, value1, value2 from table1 where id = acec5f5e-7ce2-4e8d-94bb-a00ecd7bf428', function(err, result) {
          if (err) {
            return done(err);
          }
          var rs = result.resultSet;
          expect(rs.rows).to.have.length(1);
          expect(rs.rows[0]).to.eql({
            id: 'acec5f5e-7ce2-4e8d-94bb-a00ecd7bf428',
            value1: 'value-text',
            value2: 100
          });
          conn.query('delete from table1 where id = acec5f5e-7ce2-4e8d-94bb-a00ecd7bf428', function(err) {
            if (err) {
              return done(err);
            }
            conn.query('select id, value1, value2 from table1 where id = acec5f5e-7ce2-4e8d-94bb-a00ecd7bf428', function(err, result) {
              if (err) {
                return done(err);
              }
              var rs = result.resultSet;
              expect(rs.rows).to.have.length(0);
              done();
            });
          });
        });
      });
    });

    it('should query with fewer arguments', function(done) {
      conn.query('select * from table1', [], function(err, result) {
        if (err) {
          return done(err);
        }
        expect(result.resultSet.rows).to.have.length(0);
        done();
      });
    });

    it('should query with full arguments', function(done) {
      conn.query('select * from table1', [], {}, function(err, result) {
        if (err) {
          return done(err);
        }
        expect(result.resultSet.rows).to.have.length(0);
        done();
      });
    });

    it('should fail when streams overflow', function(done) {
      // make empty streamid
      var check = function(err) {
        expect(err).to.be.ok();
        expect(err._closed).to.be.ok();
      };
      var nothing = function() {};
      var i = 0;
      for (i = 0; i < 100; i++) {
        conn.getAvailableStreamId(nothing);
      }
      expect(conn._streamIds).to.have.length(0);
      conn.getAvailableStreamId(function(err, streamId) {
        if (err) {
          return done(err);
        }
        expect(streamId).to.eql(10);
        done();
      });
      for (i = 1; i < conn._maxWaitPerConns; i++) {
        conn.getAvailableStreamId(check);
        expect(conn._streamWaitQueue).to.have.length(i+1);
      }
      conn.getAvailableStreamId(function(err) {
        expect(err).to.be.ok();
        expect(err.message).to.eql('Too many requests. Increase connection size to execute more concurrent queries.');
        conn.releaseStreamId(10);
      });
    });
  });

  describe('#prepare', function() {
    it('should prepare query', function(done) {
      conn.prepare('select * from table1', function(err, prepared) {
        if (err) {
          return done(err);
        }
        expect(prepared).to.be.ok();
        expect(prepared).to.have.keys('id', 'metadata', 'resultMetadata');
        done();
      });
    });
    it('should prepare query with parameter', function(done) {
      conn.prepare('insert into table1 (id,value1,value2) values (?,?,?)', function(err, prepared) {
        if (err) {
          return done(err);
        }
        var specs = prepared.metadata.columnSpecs;
        var values = [
          types.fromType(specs[0].type).serialize('acec5f5e-7ce2-4e8d-94bb-a00ecd7bf428'),
          types.fromType(specs[1].type).serialize('prepared-text'),
          types.fromType(specs[2].type).serialize(12345)
        ];
        conn.execute(prepared.id, values, function(err) {
          if (err) {
            return done(err);
          }
          conn.prepare('select * from table1 where id = ?', function(err, prepared) {
            conn.execute(prepared.id, [ types.uuid.serialize('acec5f5e-7ce2-4e8d-94bb-a00ecd7bf428')], function(err, result) {
              if (err) {
                return done(err);
              }
              var rs = result.resultSet;
              expect(rs).to.be.ok();
              expect(rs.rows).to.have.length(1);
              expect(rs.rows[0]).to.eql({
                id: 'acec5f5e-7ce2-4e8d-94bb-a00ecd7bf428',
                value1: 'prepared-text',
                value2: 12345
              });
              done();
            });
          });
        });
      });
    });
    it('should execute with fewer arguments', function(done) {
      conn.prepare('SELECT * FROM table1', function(err, prepared) {
        if (err) {
          return done(err);
        }
        conn.execute(prepared.id, function(err, rs) {
          if (err) {
            return done(err);
          }
          expect(rs.resultSet.rows).to.have.length(0);
          done();
        });
      });
    });
  });

  describe('#batch', function() {
    it('should execute multiple queries', function(done) {

      var uuid1 = uuid.v4();
      var uuid2 = uuid.v4();
      var uuid3 = uuid.v4();
      var uuid4 = uuid.v4();

      conn.batch([
        // normal
        ["INSERT INTO table1 (id,value1,value2) values ("+uuid1+",'batch1',2001)"],
        // parameterized
        ['INSERT INTO table1 (id,value1,value2) values (?,?,?)', [types.uuid.serialize(uuid2), types.text.serialize('batch2'), types.int.serialize(2002)]],
        // object style
        {
          query: 'INSERT INTO table1 (id,value1,value2) values (?,?,?)',
          values: [types.uuid.serialize(uuid3), types.text.serialize('batch3'), types.int.serialize(2003)]
        },
        "INSERT INTO table1 (id,value1,value2) values ("+uuid4+",'batch4',2004)",
      ], function(err) {
        if (err) {
          return done(err);
        }
        conn.query('SELECT * FROM table1', function(err, result) {
          if (err) {
            return done(err);
          }
          var rs = result.resultSet;
          expect(rs).to.be.ok();
          expect(rs.rows).to.have.length(4);
          expect(findRow(rs, uuid1)).to.eql(
            { id: uuid1, value1: 'batch1', value2: 2001 }
          );
          expect(findRow(rs, uuid2)).to.eql(
            { id: uuid2, value1: 'batch2', value2: 2002 }
          );
          expect(findRow(rs, uuid3)).to.eql(
            { id: uuid3, value1: 'batch3', value2: 2003 }
          );
          expect(findRow(rs, uuid4)).to.eql(
            { id: uuid4, value1: 'batch4', value2: 2004 }
          );
          done();
        });
      });
    });

    it('should execute multiple prepared queries', function(done) {

      var uuid1 = uuid.v4();
      var uuid2 = uuid.v4();
      var uuid3 = uuid.v4();

      conn.prepare('insert into table1 (id,value1,value2) values (?,?,?)', function(err, prepared) {
        if (err) {
          return done(err);
        }
        conn.batch([
          [prepared.id,[ types.uuid.serialize(uuid1), types.text.serialize('prepared1'), types.int.serialize(3001)]],
          {
            query: prepared.id,
            values: [types.uuid.serialize(uuid2), types.text.serialize('prepared2'), types.int.serialize(3002)]
          },
          {
            query: prepared.id,
            values: [types.uuid.serialize(uuid3), types.text.serialize('prepared3'), types.int.serialize(3003)]
          }
        ], function(err) {
          if (err) {
            return done(err);
          }
          conn.query('SELECT * from table1', function(err, result) {
            if (err) {
              return done(err);
            }
            var rs = result.resultSet;
            expect(rs).to.be.ok();
            expect(rs.rows).to.have.length(3);
            expect(findRow(rs, uuid1)).to.eql(
              { id: uuid1, value1: 'prepared1', value2: 3001 }
            );
            expect(findRow(rs, uuid2)).to.eql(
              { id: uuid2, value1: 'prepared2', value2: 3002 }
            );
            expect(findRow(rs, uuid3)).to.eql(
              { id: uuid3, value1: 'prepared3', value2: 3003 }
            );
            done();
          });
        });
      });
    });
  });

  describe('#event', function() {
    it('should register single events', function(done) {
      conn.register('SCHEMA_CHANGE', function(err, ready) {
        if (err) {
          return done(err);
        }
        expect(ready).to.be.ok();
        done();
      });
    });
    it('should register multiple events', function(done) {
      conn.register(['SCHEMA_CHANGE','TOPOLOGY_CHANGE','STATUS_CHANGE'], function(err, ready) {
        if (err) {
          return done(err);
        }
        expect(ready).to.be.ok();
        done();
      });
    });
    it('should trigger events', function(done) {
      conn.register('SCHEMA_CHANGE', function(err) {
        if (err) {
          return done(err);
        }
        var success = true;
        conn.on('event', function(event) {
          expect(event.type).to.eql('SCHEMA_CHANGE');
          expect(event.typeOfChange).to.eql('CREATED');
          expect(event.keyspace).to.eql('cql_client');
          expect(event.table).to.eql('event_dummy');
          success = true;
          done();
        });
        conn.query('create table event_dummy (id text primary key, value text)', function(err) {
          if (success) {
            return;
          }
          if (err) {
            return done(err);
          }
        });
      });
    });
  });
});

import { PromiseArray, PromiseObject } from "ember-data/system/promise_proxies";

var Relationship = function(store, record, inverseKey, relationshipMeta) {
  this.members = new Ember.OrderedSet();
  this.store = store;
  this.key = relationshipMeta.key;
  this.inverseKey = inverseKey;
  this.record = record;
  this.key = relationshipMeta.key;
  this.isAsync = relationshipMeta.options.async;
  this.relationshipMeta = relationshipMeta;
};

Relationship.prototype = {
  constructor: Relationship,
  hasFetchedLink: false,

  destroy: Ember.K,

  clear: function() {
    this.members.forEach(function(member) {
      this.removeRecord(member);
    }, this);
  },

  computeChanges: function(records) {
     var  members = this.members;

    records = setForArray(records);

    //TODO(Igor) add order preserving logic
    records.forEach(function(record) {
      if (members.has(record)) return;
      this.addRecord(record);
    }, this);

    members.forEach(function(member) {
      if (records.has(member)) return;
      this.removeRecord(member);
    }, this);
  },

  removeRecords: function(records){
    var that = this;
    records.forEach(function(record){
      that.removeRecord(record);
    });
  },

  addRecords: function(records, idx){
    var that = this;
    records.forEach(function(record){
      that.addRecord(record, idx);
      if (idx !== undefined) {
        idx++;
      }
    });
  },


  addRecord: function(record, idx) {
    if (!this.members.has(record)) {
      this.members.add(record);
      this.notifyRecordRelationshipAdded(record, idx);
      if (this.inverseKey) {
        record._relationships[this.inverseKey].addRecord(this.record);
      }
    }
  },

  removeRecord: function(record) {
    if (this.members.has(record)) {
      this.members.remove(record);
      this.notifyRecordRelationshipRemoved(record);
      if (this.inverseKey) {
        var inverseRelationship = record._relationships[this.inverseKey];
        //Need to check for existence, as the record might unloading at the moment
        if (inverseRelationship) {
          inverseRelationship.removeRecord(this.record);
        }
      }
    }
  },

  updateLink: function(link) {
    if (link !== this.link) {
      this.link = link;
      this.hasFetchedLink = false;
      this.record.notifyPropertyChange(this.key);
    }
  },

  updateRecordsFromServer: function(records) {
    //TODO Keep the newlyCreated records
    //TODO(Igor) Think about the ordering
    var delta = this.computeChanges(records);
  }
};

var ManyRelationship = function(store, record, inverseKey, relationshipMeta) {
  Relationship.apply(this, arguments);
  this.belongsToType = relationshipMeta.type;
  this.manyArray = store.recordArrayManager.createManyArray(this.belongsToType, Ember.A());
  this.manyArray.relationship = this;
  this.isPolymorphic = relationshipMeta.options.polymorphic;
  this.manyArray.isPolymorphic = this.isPolymorphic;
};

ManyRelationship.prototype = Object.create(Relationship.prototype);

ManyRelationship.prototype.constructor = ManyRelationship;
ManyRelationship.prototype.destroy = function() {
  this.manyArray.destroy();
};

ManyRelationship.prototype.notifyRecordRelationshipAdded = function(record, idx) {
  Ember.assert("You cannot add '" + record.constructor.typeKey + "' records to this relationship (only '" + this.belongsToType.typeKey + "' allowed)", !this.belongsToType || record instanceof this.belongsToType);
  this.record.notifyHasManyAdded(this.key, record, idx);
};

ManyRelationship.prototype.notifyRecordRelationshipRemoved = function(record) {
  this.record.notifyHasManyRemoved(this.key, record);
};

ManyRelationship.prototype.getValue = function() {
  if (this.isAsync) {
    var self = this;
    var promise;
    if (this.link && !this.hasFetchedLink) {
      promise = this.store.findHasMany(this.record, this.link, this.belongsToType).then(function(records){
        self.updateRecordsFromServer(records);
        self.hasFetchedLink = true;
        //TODO(Igor) try to abstract the isLoaded part
        self.manyArray.set('isLoaded', true);
        return self.manyArray;
      });
    } else {
      var manyArray = this.manyArray;
      promise = this.store.findMany(manyArray.toArray()).then(function(){
        self.manyArray.set('isLoaded', true);
        return manyArray;
      });
    }
    return PromiseArray.create({
      promise: promise
    });
  } else {
    this.manyArray.set('isLoaded', true);
    return this.manyArray;
 }
};

var BelongsToRelationship = function(store, record, inverseKey, relationshipMeta) {
  Relationship.apply(this, arguments);
  this.members.add(record);
  this.record = record;
  this.key = relationshipMeta.key;
  this.inverseKey = inverseKey;
  this.inverseRecord = null;
};

BelongsToRelationship.prototype = Object.create(Relationship.prototype);
ManyRelationship.prototype.constructor = BelongsToRelationship;

BelongsToRelationship.prototype.setRecord = function(newRecord) {
  if (newRecord) {
    this.addRecord(newRecord);
  } else if (this.inverseRecord) {
    this.removeRecord(this.inverseRecord);
  }
};

BelongsToRelationship.prototype.addRecord = function(newRecord) {
  if (this.members.has(newRecord)){ return;}
  var type = this.relationshipMeta.type;
  Ember.assert("You can only add a '" + type.typeKey + "' record to this relationship", newRecord instanceof type);

  if (this.inverseRecord && this.inverseKey) {
    this.removeRecord(this.inverseRecord);
  }

  this.inverseRecord = newRecord;
  this.constructor.prototype.addRecord.call(this, newRecord);
};

BelongsToRelationship.prototype.notifyRecordRelationshipAdded = function(newRecord) {
  this.record.notifyBelongsToAdded(this.key, this);
};

BelongsToRelationship.prototype.notifyRecordRelationshipRemoved = function(record) {
  this.record.notifyBelongsToRemoved(this.key, this);
};

BelongsToRelationship.prototype.removeRecord = function(record) {
  if (!this.members.has(record)){ return;}
  this.constructor.prototype.removeRecord.call(this, record);
  this.inverseRecord = null;
};

BelongsToRelationship.prototype.currentOtherSideFor = function() {
  return this.inverseRecord;
};

BelongsToRelationship.prototype.getValue = function() {
  if (this.isAsync) {
    var promise;

    if (this.link && !this.hasFetchedLink){
      var self = this;
      promise = this.store.findBelongsTo(this.record, this.link, this.relationshipMeta).then(function(record){
        self.addRecord(record);
        self.hasFetchedLink = true;
        return record;
      });
    } else if (this.inverseRecord) {
      var record = this.inverseRecord;
      if (record.get('isEmpty') || record.get('isLoading')) {
        promise = this.store._findByRecord(record);
      } else {
        promise = Ember.RSVP.resolve(record);
      }
    } else {
      promise = Ember.RSVP.resolve(null);
    }

    return PromiseObject.create({
      promise: promise
    });
  } else {
    //TODO(Igor) assert that we actually have it
    return this.inverseRecord;
  }
};

function setForArray(array) {
  var set = new Ember.OrderedSet();

  if (array) {
    for (var i=0, l=array.length; i<l; i++) {
      set.add(array[i]);
    }
  }

  return set;
}

var createRelationshipFor = function(record, knownSide, store){
  var inverseKey;
  var inverse = record.constructor.inverseFor(knownSide.key);

  if (inverse) {
    inverseKey = inverse.name;
  }

  if (knownSide.kind === 'hasMany'){
    return new ManyRelationship(store, record, inverseKey, knownSide);
  }
  else {
    return new BelongsToRelationship(store, record, inverseKey, knownSide);
  }
};


export {
  Relationship,
  ManyRelationship,
  BelongsToRelationship,
  createRelationshipFor
};

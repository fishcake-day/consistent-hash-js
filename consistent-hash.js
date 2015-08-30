/**
 * consistent-hash -- simple, quick, efficient hash ring (consistent hashing)
 *
 * Copyright (C) 2014-2015 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * - O(n log n) insert for any number of nodes, not O(n^2)
 * - fast js string hash computation
 * - fairly uniform hash distribution
 *
 * Based on my PHP version, see lib/Quick/Data/ConsistentHash.php
 * in https://github.com/andrasq/quicklib/
 */

function ConsistentHash( options ) {
    this._nodes = new Array()
    this._nodeKeys = new Array()
    this._keyMap = {}
    this._keys = null
    this.nodeCount = 0
    this.keyCount = 0

    options = options || {}
    if (options.range) this._range = options.range

    if (this._flip8Map[1] != 0x80) {
        var i, k
        for (i=0; i<256; i++) {
            function flipit(b1) {
                var k, bit, b2 = 0
                for (k=0; k<8; k++) {
                    bit = 1 << k
                    if (b1 & bit) b2 |= (1 << (7 - k))
                }
                return b2
            }
            this._flip8Map[i] = flipit(i)
        }
    }
}

ConsistentHash.prototype = {
    _nodes: null,               // list of node objects
    _nodeKeys: null,            // list of control points for each node
    _keyMap: null,              // control point to node map
    // sorted keys array will be regenerated whenever set to falsy
    _keys: null,                // array of sorted control points
    _range: 1009,               // hash ring capacity.  Smaller values (1k) distribute better (100k)
    _flip8Map: new Array(256),  // flip the bits in byte, msb to lsb
    _flip4Map: [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15],

    /**
     * add n instances of the node at random positions around the hash ring
     */
    add:
    function add( node, n, points ) {
        var i, key
        n = n || 1
        if (Array.isArray(points)) points = this._copy(points)
        else points = this._makeControlPoints(n)
        this._nodes.push(node)
        this._nodeKeys.push(points)
        for (i=0; i<n; i++) this._keyMap[points[i]] = node
        this._keys = null
        this.keyCount += n
        this.nodeCount += 1
        return this
    },

    locateNext:
    function locateNext( node, offset ) {
        var i, ix = this._nodes.indexOf(node)
        if (ix < 0) return null
// WRITEME: return the array of nodes following the control points of node
        return []
    },

    _copy:
    function _copy( o ) {
        if (Array.isArray(o)) {
            var i, ret = new Array(o.length)
            for (i=0; i<o.length; i++) ret[i] = o[i]
            return ret
        }
        else {
            var k, ret = {}
            for (k in o) ret[k] = o[k]
            return ret
        }
    },

    _makeControlPoints:
    function _makeControlPoints( n ) {
        var attemptCount = 0
        var i, points = new Array(n)
        for (i=0; i<n; i++) {
            // use probabilistic collision detection: ok for up to millions
            do {
                key = Math.random() * this._range >>> 0
            } while ((this._keyMap[key] !== undefined || points[key] !== undefined) && ++attemptCount < 10)
            //if (attemptCount >= 1000) throw new Error("unable to find an unused control point, tried 1000 times")
            // reuse control points after 10 attempts to find an unused one
            points[i] = key
        }
        return points
    },

    /**
     * remove all instances of the node from the hash ring
     */
    remove:
    function remove( node ) {
        var ix
        // note: indexOf() is a very fast O(n) linear search by pointer
        // loop to get duplicate entries too
        while ((ix = this._nodes.indexOf(node)) >= 0) {
            var keys = this._nodeKeys[ix]
            this._nodes[ix] = this._nodes[this._nodes.length - 1]
            this._nodes.length -= 1
            this._nodeKeys[ix] = this._nodeKeys[this._nodeKeys.length - 1]
            this._nodeKeys.length -= 1
            this._keys = null
            this.keyCount -= keys.length
            this.nodeCount -= 1
        }
        return this
    },

    /**
     * return the first node in the hash ring after name
     */
    get:
    function get( name ) {
        if (!this._keys) this._buildKeys()
        if (!this.keyCount) return null
        var h = this._hash(name)

        // the hash lsbyte too closely tracks the input strings, eg a
        // trailing decimal suffix 'a1234' skews the hash distribution
        // because ascii 0-9 is always in the range 0000-1001
        // Dropping a few of the least significant bits counters this,
        // but makes 'a1', 'a2', 'a3' hash to the same node (however, it
        // does not skip nodes 10-16 for strings /a[0-9]+/)
        //h = h >>> 3

        // Using (hash mod _range) also seems to counter it, esp for small _range
        h = h % this._range

        var index = this._absearch(this._keys, h)
//console.log("AR: idx", key.toString(16), this.keyCount, index)
        return this._keyMap[this._keys[index]]
    },

    /**
     * return the first n nodes in the hash ring after name
     */
/***
// FIXME: BROKEN: do not return n distinct, return the nodes of the next N control points for fall-through handling
    getMany:
    function getMany( name, n ) {
        if (!this._keys) this._buildKeys()
        var key = this._hash(name)
        var index = this._absearch(this._keys, key)
        if (index < 0) return []
        var i, foundKeys = {}, foundNodes = [], node
        function returnNodeAt( i ) {
            if (!foundKeys[this._keys[i]]) {
                foundKeys[this._keys[i]] = true
                foundNodes.push(this._keyMap[this._keys[i]])
            }
        }
        for (i=index; foundNodes.length < n && i<this._keys.length; i++) returnNodeAt(i)
        for (i=0; foundNodes.length < n && i<index; i++) returnNodeAt(i)
        return foundNodes
    },
***/

    // 24-bit PJW string hash
    _hash:
    function _pjwHash(s) {
        var len = s.length
        var g, h = 0
        for (var i=0; i<len; i++) {
            h = (h << 4) + s.charCodeAt(i)
            g = h & 0xf000000           // isolate high 4 bits
            if (g) {
                h ^= g                  // clear high 4 bits
                h ^= (g >>> 24)         // xor high 4 bits into low byte
            }
        }
        // for well distributed input, h has a good distribution in the lsb`s
        // but for correlated input eg /a[0-9]+/ it is skewed and caller must fix
        return h

        // h has a good distribution in the lsb`s,
        // need to move that to the msb`s, else all short strings
        // will map to bin[0].
// AR: do not flip if returning mod
//        var flip8 = this._flip8Map
//        h = (flip8[(h) & 0xff] << 16) | (flip8[(h >>> 8) & 0xff] << 8) | (flip8[(h >>> 16) & 0xff])
// the lsbyte too closely tracks the input strings, eg a
// trailing decimal suffix 'a1234' skews the hash distribution.
// Drop a few of the least significant bits to offset this.
//return h >>> 3
        return h
    },

    // compute an unsigned integer hash for the resource name
    _hash2:
    function _crcHash( s ) {
        // rotate left 5 bits, xor in each new byte
        // http://www.cs.hmc.edu/~geoff/classes/hmc.cs070.200101/homework10/hashfuncs.html
        var len = s.length
        var g, h = 0
        // TODO: speed up the hash computation for long strings
        // the hash does not have to be perfect, just well distributed
        for (var i=0; i<len; i++) {
            // 20-bit hash
            //g = h & 0xf8000
            //h = (((h & ~0xf8000) << 5) | (g >>> 15)) ^ s.charCodeAt(i)
            // 24-bit hash
            g = h & 0xf80000
            h = (((h & ~0xf80000) << 5) | (g >>> 19)) ^ s.charCodeAt(i)
            // 31-bit hash
            //g = h & 0x78000000
            //h = (((h & ~0x7800000) << 5) | (g >>> 26)) ^ s.charCodeAt(i)
        }
        // TODO: h has a good distribution in the lsb`s,
        // need to move that to the msb`s, else all short strings
        // will map to bin[0].  Extend 20-bit hash to 24-bit range
        var flip8 = this._flip8Map
        h = (flip8[(h) & 0xff] << 16) | (flip8[(h >>> 8) & 0xff] << 8) | (flip8[(h >>> 16) & 0xff])
// FIXME: distribution is not as uniform as one would expect...
        return h
    },

    // binary search the sorted array for the location of the key
    // returns the index of the first value >= key, or 0 if key > max(array)
    _absearch:
    function _absearch( array, key ) {
        var i, j, mid, gap = 25, len = array.length
        for (i=0, j=len-1; j - i > gap; ) {
            mid = (i + j) >>> 1
            if (array[mid] < key) i = mid + 1
            else j = mid
        }
        // faster to linear search once the location is narrowed to gap items
        for ( ; i<len; i++) if (array[i] >= key) return i
        return array.length === 0 ? -1 : 0
    },

    // regenerate the sorted keys array
    _buildKeys:
    function _buildKeys( ) {
        var i, j, nodeKeys, keys = new Array()
        for (i=0; i<this._nodeKeys.length; i++) {
            nodeKeys = this._nodeKeys[i]
            for (j=0; j<nodeKeys.length; j++) {
                keys.push(nodeKeys[j])
            }
        }
        // note: duplicate keys are not filtered out, but should work ok
        keys.sort(function(a,b){ return a - b })
        return this._keys = keys
    }
}

module.exports = ConsistentHash
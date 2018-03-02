// Copyright 2018 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

const KB = 1024;
const MB = KB * KB;
const kMillis2Seconds = 1 / 1000;

class Isolate {
  constructor(address) {
    this.address = address;
    this.start = null;
    this.end = null;
    this.samples = Object.create(null);
    this.non_empty_instance_types = new Set();
    this.gcs = Object.create(null);
    this.zonetags = [];
    this.samples = {zone: {}};
    this.data_sets = new Set();
    this.peakMemory = 0;
    // Maps instance_types to their max memory consumption over all gcs.
    this.instanceTypePeakMemory = Object.create(null);
    // Peak memory consumed by any single instance type.
    this.singleInstanceTypePeakMemory = 0;
  }

  finalize() {
    Object.values(this.gcs).forEach(gc => this.finalizeGC(gc));
    this.sortInstanceTypePeakMemory();
  }

  getLabel() {
    let label = `${this.address}: gc=#${Object.keys(this.gcs).length}`;
    const peakSizeMB = Math.round(this.peakMemory / 1024 / 1024 * 100) / 100;
    label += ` peak=${peakSizeMB}MB`
    return label;
  }

  finalizeGC(gc_data) {
    this.data_sets.forEach(key => this.finalizeDataSet(gc_data[key]));
    if (!('live' in gc_data)) return;
    let liveData = gc_data.live;
    this.peakMemory = Math.max(this.peakMemory, liveData.overall);
    let data = liveData.instance_type_data;
    for (let name in data) {
      let prev = this.instanceTypePeakMemory[name] || 0;
      this.instanceTypePeakMemory[name] = Math.max(prev, data[name].overall);
    }
  }

  finalizeDataSet(data_set) {
    // Create a ranked instance type array that sorts instance types by
    // memory size (overall).
    data_set.ranked_instance_types =
        [...data_set.non_empty_instance_types].sort(function(a, b) {
          if (data_set.instance_type_data[a].overall >
              data_set.instance_type_data[b].overall) {
            return 1;
          } else if (
              data_set.instance_type_data[a].overall <
              data_set.instance_type_data[b].overall) {
            return -1;
          }
          return 0;
        });

    Object.entries(data_set.instance_type_data).forEach(([name, entry]) => {
      this.checkHistogram(
          name, entry, data_set.bucket_sizes, 'histogram', ' overall');
      this.checkHistogram(
          name, entry, data_set.bucket_sizes, 'over_allocated_histogram',
          ' over_allocated');
    });
  }

  // Check that a lower bound for histogram memory does not exceed the
  // overall counter.
  checkHistogram(type, entry, bucket_sizes, histogram, overallProperty) {
    let sum = 0;
    for (let i = 1; i < entry[histogram].length; i++) {
      sum += entry[histogram][i] * bucket_sizes[i - 1];
    }
    const overall = entry[overallProperty];
    if (sum >= overall) {
      console.error(
          `${type}: sum('${histogram}') > overall (${sum} > ${overall})`);
    }
  }

  sortInstanceTypePeakMemory() {
    let entries = Object.entries(this.instanceTypePeakMemory);
    entries.sort((a, b) => {return b[1] - a[1]});
    this.instanceTypePeakMemory = Object.create(null);
    let max = 0;
    for (let [key, value] of entries) {
      this.instanceTypePeakMemory[key] = value;
      max = Math.max(max, value);
    }
    this.singleInstanceTypePeakMemory = max;
  }

  getInstanceTypePeakMemory(type) {
    if (!(type in this.instanceTypePeakMemory)) return 0;
    return this.instanceTypePeakMemory[type];
  }
}

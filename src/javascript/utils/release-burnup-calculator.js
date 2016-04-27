Ext.define('Rally.technicalservices.ReleaseBurnupCalculator',{
    extend: 'Rally.data.lookback.calculator.TimeSeriesCalculator',
    config: {
        completedScheduleStateNames: ['Accepted'],
        usePoints: true
    },

    constructor: function(config) {
        this.initConfig(config);
        this.callParent(arguments);
    },

    getDerivedFieldsOnInput: function() {
        var completedScheduleStateNames = this.getCompletedScheduleStateNames(),
            usePoints = this.usePoints,
            preliminaryEstimateValues = this.preliminaryEstimateValueHashByObjectID;

        var fields = [
            {
               "as": "PreliminaryEstimate",
                "f": function(snapshot){
                    if (snapshot.PreliminaryEstimate){
                        return preliminaryEstimateValues[snapshot.PreliminaryEstimate] || 0;
                    }
                    return 0;
                }
            },{
                "as": "Planned",
                "f": function(snapshot) {
                    if (snapshot.ScheduleState){ //We've added this to weed out the portfolio items for the count
                        if (usePoints){
                            return snapshot.PlanEstimate || 0;
                        } else {
                            return 1;
                        }
                    }
                    return 0;
                }
            }];

        Ext.Array.each(completedScheduleStateNames, function(ss){
            fields.push({
                "as": ss,
                "f": function(snapshot) {
                    if (snapshot.ScheduleState === ss) {
                        if (usePoints){
                            return snapshot.PlanEstimate || 0;
                        } else {
                            return 1;
                        }
                    }
                    return 0;
                }
            });
        });

        return fields;
    },

    getMetrics: function() {
        var completedScheduleStateNames = this.getCompletedScheduleStateNames(),
            metrics = [];

        Ext.Array.each(completedScheduleStateNames, function(ss){
            metrics.push({
                "field": ss,
                "as": ss,
                "f": "sum",
                "display": "column"
            });
        });

        metrics = metrics.concat([{
            "field": "Planned",
            "as": "Planned",
            "display": "line",
            "f": "sum"
        },{
            "field": "PreliminaryEstimate",
            "as": "PreliminaryEstimate",
            "display": "line",
            "f": "sum"
        }]);

        return metrics;
    },
    _getSummedData: function(seriesData, metricNames){

        if (!Ext.isArray(metricNames)){
            metricNames = [metricNames];
        }

        var sum_xy = 0;
        var sum_x = 0;
        var sum_y = 0;
        var sum_x_squared = 0;
        var n = 0;
        for (var i=0; i<seriesData.length; i++){
            var val = 0;
            Ext.Array.each(metricNames, function(m){
                val += (seriesData[i][m] || 0);
            });

            if (val){
                sum_xy += val * i;
                sum_x += i;
                sum_y += val;
                sum_x_squared += i * i;
                n++;
            }
        }
        return {
            sumXY: sum_xy,
            sumX: sum_x,
            sumY: sum_y,
            sumXSquared: sum_x_squared,
            n: n
        };
    },
    _getSlope: function(summedData){

        if ((summedData.n * summedData.sumXSquared - summedData.sumX * summedData.sumX) !== 0){
            return (summedData.n*summedData.sumXY - summedData.sumX * summedData.sumY)/(summedData.n*summedData.sumXSquared - summedData.sumX * summedData.sumX);
        }
        return 0;
    },
    _getIntercept: function(summedData){
        var slope = this._getSlope(summedData);
        if (summedData.n === 0){
            return 0;
        }

        return (summedData.sumY - slope * summedData.sumX)/summedData.n;
    },
    getSummaryMetricsConfig: function () {
        var me = this,
            completedScheduleStates = this.completedScheduleStateNames;
        return [{
                  "as": "planned_slope",
                  "f": function(seriesData, metrics) {
                      var summedData = me._getSummedData(seriesData, "Planned");
                      return me._getSlope(summedData);
                  }
              },{
            "as": "planned_intercept",
            "f": function(seriesData, metrics) {
                var summedData = me._getSummedData(seriesData, "Planned");
                return me._getIntercept(summedData);
            }
        },{
            "as": "accepted_slope",
            "f": function(seriesData, metrics) {
                var summedData = me._getSummedData(seriesData, completedScheduleStates);
                return me._getSlope(summedData);
            }
        },{
            "as": "accepted_intercept",
            "f": function(seriesData, metrics) {
                var summedData = me._getSummedData(seriesData, completedScheduleStates);
                return me._getIntercept(summedData);
            }
        }];
    },
    getDerivedFieldsAfterSummary: function () {
        return [{
                 "as": "Prediction (Planned Points)",
                 "f": function(snapshot, index, metrics, seriesData) {
                      return metrics.planned_intercept + metrics.planned_slope * index;
                  },
                  "display": "line",
                  "dashStyle": "ShortDash"
             },{
            "as": "Prediction (Accepted Points)",
            "f": function(snapshot, index, metrics, seriesData) {
                return metrics.accepted_intercept + metrics.accepted_slope * index;
            },
            "display": "line",
            "dashStyle": "ShortDash"
        }];
    },
    prepareChartData: function (stores) {
        var snapshots = [], ids = [];

        Ext.Array.each(stores, function (store) {
            store.each(function(record){
                var data = record.raw;
                //We need to make sure the snapshots are unique so we are filtering them here.
                //The alternative is making a single store config that can filter both.
                //This approach may not be faster, but it makes the configuration code easier to read.
                if (!Ext.Array.contains(ids, data._id)){
                    ids.push(data._id);
                    snapshots.push(data);
                }
            });
        });
        console.log('snapshots',snapshots);

        return this.runCalculation(snapshots);
    },
    _getTrendline: function(series){
        /**
         * Regression Equation(y) = a + bx
         * Slope(b) = (NΣXY - (ΣX)(ΣY)) / (NΣX2 - (ΣX)2)
         * Intercept(a) = (ΣY - b(ΣX)) / N
         */

        var sum_xy = 0;
        var sum_x = 0;
        var sum_y = 0;
        var sum_x_squared = 0;
        var n = 0;
        for (var i=0; i<series.data.length; i++){
            if (series.data[i].y){
                sum_xy += series.data[i].y * i;
                sum_x += i;
                sum_y += series.data[i].y;
                sum_x_squared += i * i;
                n++;
            }
        }
        var slope = (n*sum_xy - sum_x * sum_y)/(n*sum_x_squared - sum_x * sum_x);
        var intercept = (sum_y - slope * sum_x)/n;

        this.logger.log('trendline data (name, slope, intercept)',series.name, slope, intercept);

        var y = [];
        if (!isNaN(slope) && !isNaN(intercept)){
            y = _.range(series.data.length).map(function () {return null})
            for (var i =0; i<series.data.length; i++){
                y[i] = intercept + slope * i;
            }
        }
        this.logger.log('_getTrendline', y);
        return {
            name: series.name + ' Trendline',
            color: series.color,
            data: y,
            display: 'line',
            dashStyle: 'LongDash'
        };

    }
});

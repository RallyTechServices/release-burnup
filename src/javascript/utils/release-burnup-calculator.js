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
    }
});

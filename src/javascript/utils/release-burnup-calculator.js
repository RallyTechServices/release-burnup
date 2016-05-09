Ext.define('Rally.technicalservices.ReleaseBurnupCalculator',{
    extend: 'Rally.data.lookback.calculator.TimeSeriesCalculator',
    config: {
        completedScheduleStateNames: ['Accepted'],
        usePoints: true,
        plannedPredictionLineName: "Prediction (Planned Points)",
        acceptedPredictionLineName: "Prediction (Accepted Points)"
    },

    constructor: function(config) {
        this.initConfig(config);
        this.callParent(arguments);
    },
    _getTypes: function(){
        var typeHierarchy = [];
        if (this.showStories){
            typeHierarchy.push('HierarchicalRequirement');
        }
        if (this.showDefects){
            typeHierarchy.push('Defect');
        }
        return typeHierarchy;
    },
    getDerivedFieldsOnInput: function() {
        var completedScheduleStateNames = this.getCompletedScheduleStateNames(),
            usePoints = this.usePoints;

        var fields = [
            {
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

        var typeHierarchy = this._getTypes();

        Ext.Array.each(completedScheduleStateNames, function(ss){
            Ext.Array.each(typeHierarchy, function(t){
                fields.push({
                    "as": ss + t,
                    "f": function(snapshot) {
                        if (Ext.Array.contains(snapshot._TypeHierarchy, t) && snapshot.ScheduleState === ss) {
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
        });

        return fields;
    },
    _getColors: function(completedStateNames){
        var colors = {};

        colors["AcceptedHierarchicalRequirement"] = "#8DC63F";
        colors["AcceptedDefect"] = "#FBB990";

        if (completedStateNames.length > 1){
            colors[completedStateNames[1]+"HierarchicalRequirement"] = "#1E7C00" ;
            colors[completedStateNames[1]+"Defect"] = "#FF8200";
        }

        colors["Planned"] =  "#7CAFD7";
        colors[this.plannedPredictionLineName] = "#666";
        colors[this.acceptedPredictionLineName] = "#005EB8";

        return colors;
    },
    getMetrics: function() {
        var completedScheduleStateNames = this.getCompletedScheduleStateNames(),
            metrics = [],
            typeHierarchy = this._getTypes(),
            colors = this._getColors(completedScheduleStateNames);

        Ext.Array.each(completedScheduleStateNames, function(ss){
            Ext.Array.each(typeHierarchy, function(t){
                var fieldDisplayName = Ext.String.format("{0} ({1})",ss,t.replace('HierarchicalRequirement','User Story'));
                metrics.push({
                    "field": ss + t,
                    "as": fieldDisplayName,
                    "f": "sum",
                    "display": "column",
                    "color": colors[ss+t]
                });
            });
        });

        metrics = metrics.concat([{
            "field": "Planned",
            "as": "Planned",
            "display": "line",
            "f": "sum",
            "color": colors.Planned
        }]);

        return metrics;
    },
    _getSummedData: function(seriesData, metricNames, types){
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
                Ext.Array.each(types, function(t){
                    var fieldDisplayName = Ext.String.format("{0} ({1})",m,t.replace('HierarchicalRequirement','User Story'));
                    val += (seriesData[i][fieldDisplayName] || 0);
                });
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
            completedScheduleStates = this.completedScheduleStateNames,
            summaryMetrics = [],
            types = this._getTypes();

        if (this.showPlannedPredictionLine){
            summaryMetrics = summaryMetrics.concat({
                "as": "planned_slope",
                "f": function(seriesData, metrics) {
                    var summedData = me._getSummedData(seriesData, "Planned", types);
                    return me._getSlope(summedData);
                }
            },{
                "as": "planned_intercept",
                "f": function(seriesData, metrics) {
                    var summedData = me._getSummedData(seriesData, "Planned", types);
                    return me._getIntercept(summedData);
                }
            });
        }

        if (this.showAcceptedPredictionLine){
            summaryMetrics = summaryMetrics.concat({
                "as": "accepted_slope",
                "f": function(seriesData, metrics) {
                    var summedData = me._getSummedData(seriesData, completedScheduleStates, types);
                    return me._getSlope(summedData);
                }
            },{
                "as": "accepted_intercept",
                "f": function(seriesData, metrics) {
                    var summedData = me._getSummedData(seriesData, completedScheduleStates, types);
                    return me._getIntercept(summedData);
                }
            });
        }
        return summaryMetrics;
    },
    getDerivedFieldsAfterSummary: function () {

        var metrics = [],
            colors = this._getColors(this.completedScheduleStateNames);

        if (this.showPlannedPredictionLine){
           metrics.push({
               "as": this.plannedPredictionLineName ,
               "f": function(snapshot, index, metrics, seriesData) {
                   return Math.round(metrics.planned_intercept + metrics.planned_slope * index);

               },
               "display": "line",
               "dashStyle": "ShortDash",
               "color": colors[this.plannedPredictionLineName]
           });
        }

        if (this.showAcceptedPredictionLine){
            metrics.push({
                "as": this.acceptedPredictionLineName,
                "f": function(snapshot, index, metrics, seriesData) {
                    return Math.round(metrics.accepted_intercept + metrics.accepted_slope * index);
                },
                "display": "line",
                "dashStyle": "ShortDash",
                "color": colors[this.acceptedPredictionLineName]
            });
        }
        return metrics;
    },
    prepareChartData: function (stores) {
        var snapshots = [], ids = [];
        console.log('store', stores)
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
        return this.runCalculation(snapshots);
    }
});

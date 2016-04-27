Ext.define("release-burnup", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    items: [
        {xtype:'container',itemId:'headerBox', layout: 'hbox'},
        {xtype:'container',itemId:'displayBox'}
    ],

    integrationHeaders : {
        name : "ts-release-burnup"
    },

    chartUnits: ['Points','Count'],  //Default is first in the list
    portfolioItemTypes: ['PortfolioItem/Feature'],
    completedStates: ['Accepted', 'Released'],
    preliminaryEstimateValueHashByObjectID: {},

    timeboxStartDateField: 'ReleaseStartDate',
    timeboxEndDateField: 'ReleaseDate',
    timeboxType: 'release',
    timeboxTypePicker: 'rallyreleasecombobox',

    launch: function() {

        Deft.Promise.all([
            Rally.technicalservices.Toolbox.fetchPortfolioItemTypes(),
            Rally.technicalservices.Toolbox.fetchScheduleStates(),
            Rally.technicalservices.Toolbox.fetchPreliminaryEstimateValues()
        ]).then({
            success: this._initializeApp,
            failure: this._showError,
            scope: this
        });

    },
    _initializeApp: function(results){
        this.portfolioItemTypes = _.map(results[0], function(r){ return r.get('TypePath'); });
        this.completedStates = results[1].slice(_.indexOf(results[1],"Accepted"));
        this.preliminaryEstimateValueHashByObjectID = _.reduce(results[2],function(hash, record){
            hash[record.get('ObjectID')] = record.get('Value');
            return hash;
        },{});
        this.logger.log('_initializeApp', this.portfolioItemTypes, this.completedStates, this.preliminaryEstimateValueHashByObjectID);

        this._addComponents();
    },
    isOnScopedDashboard: function(){
        if (this.getContext().getTimeboxScope() && this.getContext().getTimeboxScope().type === this.timeboxType){
            return true;
        }
        return false;
    },
    _addComponents: function(){
        var headerBox = this.down('#headerBox');
        headerBox.removeAll();
        if (!this.isOnScopedDashboard()){
            var rcb = headerBox.add({
                xtype: this.timeboxTypePicker
            });
            rcb.on('select', this.onScopeChange, this);
        }
        var cb = headerBox.add({
            xtype: 'tscustomcombobox',
            itemId: 'cbUnit',
            allowedValues: this.chartUnits
        });
        cb.on('select',this._updateBurnup, this);
        this.onScopeChange();
    },
    getUnit: function(){
        return this.down('#cbUnit') && this.down('#cbUnit').getValue() || this.chartUnits[0];
    },
    getTimeboxStartDate: function(){
        var record = this.getTimeboxRecord();
        return record.get(this.timeboxStartDateField);
    },
    getTimeboxEndDate: function(){
        var record = this.getTimeboxRecord();
        return record.get(this.timeboxEndDateField);
    },
    getTimeboxRecord: function(){
        var record = null;
        if (this.isOnScopedDashboard()){
            record = this.getContext().getTimeboxScope().getRecord();
        } else {
            record = this.down(this.timeboxTypePicker) && this.down(this.timeboxTypePicker).getRecord();
        }
        return record;
    },
    getTimeboxFilter: function(isForTimebox){
        var record = this.getTimeboxRecord();

        var prefix = isForTimebox ? "" : Ext.String.capitalize(this.timeboxType) + ".";

        if (record){
            return Rally.data.wsapi.Filter.and([
                {
                    property: prefix + 'Name',
                    value: record.get('Name')
                },
                {
                    property: prefix + this.timeboxStartDateField,
                    value: Rally.util.DateTime.toUtcIsoString(this.getTimeboxStartDate())
                },
                {
                    property: prefix + this.timeboxEndDateField,
                    value: Rally.util.DateTime.toUtcIsoString(this.getTimeboxEndDate())
                }
            ]);
        }
        return [];
    },
    onScopeChange: function(){
        var timeboxFilter = this.getTimeboxFilter();
        this.logger.log('onScopeChange', timeboxFilter.toString());

        this.releases = [];
        this.portfolioItems = [];

        if (!timeboxFilter || timeboxFilter.length === 0){
            this._showMissingCriteria();
            return;
        }

        var promises = [Rally.technicalservices.Toolbox.fetchData({
            model: Ext.String.capitalize(this.timeboxType),
            fetch: ['ObjectID'],
            filters: this.getTimeboxFilter(true)
        }), Rally.technicalservices.Toolbox.fetchData({
            model: this.portfolioItemTypes[0],
            fetch: ['ObjectID','PreliminaryEstimate','Value'],
            filters: timeboxFilter
        })];

        Deft.Promise.all(promises).then({
            success: function(results){
                this.timeboxes = results[0];
                this.portfolioItems = results[1];
                this._updateBurnup();
            },
            failure: this._showError,
            scope: this
        });
    },
    _getFieldValueArray: function(records, fieldName){
        return _.map(records || [], function(r){ return r.get(fieldName); });
    },
    _showMissingCriteria: function(){
        this.down('#displayBox').removeAll();
        this.down('#displayBox').add({
            xtype: 'container',
            html: 'Please select a release filter.'
        });
    },
    _showError: function(msg){
        Rally.ui.notify.Notifier.showError({message: msg});
    },
    _updateBurnup: function(){
        this.logger.log('_updateBurnup', this.getUnit());

        if (!this.timeboxes || this.timeboxes.length === 0){
            this._showMissingCriteria();
            return;
        }

        this.down('#displayBox').removeAll();

        this.down('#displayBox').add({
            xtype: 'rallychart',
            chartColors: ['#8DC63F','#1E7C00','#7CAFD7','#ffb533','#666','#005EB8'],
            storeType: 'Rally.data.lookback.SnapshotStore',
            storeConfig: this._getStoreConfig(),
            calculatorType: 'Rally.technicalservices.ReleaseBurnupCalculator',
            calculatorConfig: {
                usePoints: this.getUnit() === 'Points',
                completedScheduleStateNames: this.completedStates,
                startDate: this.getTimeboxStartDate(),
                endDate: this.getTimeboxEndDate(),
                preliminaryEstimateValueHashByObjectID: this.preliminaryEstimateValueHashByObjectID
            },
            chartConfig: this._getChartConfig()
        });
    },
    _getStoreConfig: function(){

        var rOids = this._getFieldValueArray(this.timeboxes,'ObjectID'),
            piOids = this._getFieldValueArray(this.portfolioItems,'ObjectID');

        var configs = [{
            find: {
                _TypeHierarchy: "PortfolioItem/Feature",
                Release: {$in: rOids}
            },
            fetch: ['PreliminaryEstimate','_id'],
            hydrate: ['PreliminaryEstimate'],
            removeUnauthorizedSnapshots: true,
            sort: {
                _ValidFrom: 1
            },
            context: this.getContext().getDataContext(),
            limit: Infinity
        },{
            find: {
                _TypeHierarchy: {$in: ['HierarchicalRequirement','Defect']},
                Children: null,
                Release: {$in: rOids}
            },
            fetch: ['ScheduleState', 'PlanEstimate','_id'],
            hydrate: ['ScheduleState'],
            removeUnauthorizedSnapshots: true,
            sort: {
                _ValidFrom: 1
            },
            context: this.getContext().getDataContext(),
            limit: Infinity
        }];

        if (piOids && piOids.length > 0){
            configs.push({
                find: {
                        _TypeHierarchy: {$in: ['HierarchicalRequirement','Defect']},
                        Children: null,
                        _ItemHierarchy: {$in: piOids}
                },
                fetch: ['ScheduleState', 'PlanEstimate','_id'],
                hydrate: ['ScheduleState'],
                removeUnauthorizedSnapshots: true,
                sort: {
                    _ValidFrom: 1
                },
                context: this.getContext().getDataContext(),
                limit: Infinity
            });
        }
        return configs;
    },
    _getChartConfig: function(){
        return {
            chart: {
                defaultSeriesType: 'area',
                zoomType: 'xy'
            },
            title: {
                text: this.getTimeboxRecord() && this.getTimeboxRecord().get('Name') || "No Release",
                style: {
                    color: '#666',
                    fontSize: '18px',
                    fontFamily: 'ProximaNova',
                    fill: '#666'
                }
            },
            xAxis: {
                categories: [],
                tickmarkPlacement: 'on',
                tickInterval: 5,
                title: {
                    text: 'Date',
                    margin: 10,
                    style: {
                        color: '#444',
                        fontFamily:'ProximaNova',
                        textTransform: 'uppercase',
                        fill:'#444'
                    }
                },
                labels: {
                    style: {
                        color: '#444',
                        fontFamily:'ProximaNova',
                        textTransform: 'uppercase',
                        fill:'#444'
                    }
                }
            },
            yAxis: [
                {
                    title: {
                        text: this.getUnit(),
                        style: {
                            color: '#444',
                            fontFamily:'ProximaNova',
                            textTransform: 'uppercase',
                            fill:'#444'
                        }
                    },
                    labels: {
                        style: {
                            color: '#444',
                            fontFamily:'ProximaNova',
                            textTransform: 'uppercase',
                            fill:'#444'
                        }
                    }
                }
            ],
            legend: {
                itemStyle: {
                        color: '#444',
                        fontFamily:'ProximaNova',
                        textTransform: 'uppercase'
                },
                borderWidth: 0
            },
            tooltip: {
                formatter: function() {
                    return '' + this.x + '<br />' + this.series.name + ': ' + this.y;
                }
            },
            plotOptions: {
                series: {
                    marker: {
                        enabled: false,
                        states: {
                            hover: {
                                enabled: true
                            }
                        }
                    },
                    groupPadding: 0.01
                },
                column: {
                    stacking: true,
                    shadow: false
                }
            }
        };
    },
    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    
    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },
    
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },
    
    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings){
        this.logger.log('onSettingsUpdate',settings);
        // Ext.apply(this, settings);
        this.launch();
    }
});

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

    config: {
        defaultSettings: {
            showPredictionLines: false,
            showDefects: true,
            showStories: true
        }
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
            Rally.technicalservices.Toolbox.fetchScheduleStates()
        //    Rally.technicalservices.Toolbox.fetchPreliminaryEstimateValues()
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
            rcb.on('select', this.updateTimebox, this);
        }
        var cb = headerBox.add({
            xtype: 'tscustomcombobox',
            itemId: 'cbUnit',
            allowedValues: this.chartUnits
        });
        cb.on('select',this._updateBurnup, this);
        this.updateTimebox();
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
    updateTimebox: function(){
        var timeboxFilter = this.getTimeboxFilter();
        this.logger.log('updateTimebox', timeboxFilter.toString());

        this.releases = [];
        this.portfolioItems = [];

        if (!timeboxFilter || timeboxFilter.length === 0){
            this._showMissingCriteria();
            return;
        }
        this.setLoading(true);
        var promises = [Rally.technicalservices.Toolbox.fetchData({
            model: Ext.String.capitalize(this.timeboxType),
            fetch: ['ObjectID'],
            filters: this.getTimeboxFilter(true)
        }), Rally.technicalservices.Toolbox.fetchData({
            model: this.portfolioItemTypes[0],
            fetch: ['ObjectID','PreliminaryEstimate','Value'],
            context: {project: null},
            filters: timeboxFilter
        })];

        var me = this;
        Deft.Promise.all(promises).then({

            success: function(results){
                this.logger.log('updateTimebox Results', results);
                this.timeboxes = results[0];
                this.portfolioItems = results[1];
                this._updateBurnup();
            },
            failure: this._showError,
            scope: this
        }).always(function(){
            me.setLoading(false);
        });
    },
    onTimeboxScopeChange: function(timeboxScope){
        this.logger.log('onTimeboxScopeChange',timeboxScope);
        if (timeboxScope && timeboxScope.type === this.timeboxType){
            this.getContext().setTimeboxScope(timeboxScope);
            this.updateTimebox();
        }
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
            chartColors: ['#8DC63F','#1E7C00','#7CAFD7','#666','#005EB8'],
            storeType: 'Rally.data.lookback.SnapshotStore',
            storeConfig: this._getStoreConfig(),
            calculatorType: 'Rally.technicalservices.ReleaseBurnupCalculator',
            calculatorConfig: {
                usePoints: this.getUnit() === 'Points',
                completedScheduleStateNames: this.completedStates,
                startDate: this.getTimeboxStartDate(),
                endDate: this.getTimeboxEndDate(),
                showPredictionLines: this.getShowPredictionLines()
                //preliminaryEstimateValueHashByObjectID: this.preliminaryEstimateValueHashByObjectID
            },
            chartConfig: this._getChartConfig()
        });
    },
    getShowPredictionLines: function(){
        return this.getSetting('showPredictionLines') === 'true' || this.getSetting('showPredictionLines') === true;
    },
    getShowDefects: function(){
        return this.getSetting('showDefects') === 'true' || this.getSetting('showDefects') === true ;
    },
    getShowStories: function(){
        var showStories = this.getSetting('showStories') === 'true' || this.getSetting('showStories') === true ;
        if (!this.getShowDefects()){
            return true;
        }
        return showStories;

    },
    _getStoreConfig: function(){

        var rOids = this._getFieldValueArray(this.timeboxes,'ObjectID'),
            piOids = this._getFieldValueArray(this.portfolioItems,'ObjectID'),
            projectOid = this.getContext().getProject().ObjectID;

        var typeHierarchy = [];
        if (this.getShowStories()){
            typeHierarchy.push('HierarchicalRequirement');
        }
        if (this.getShowDefects()){
            typeHierarchy.push('Defect');
        }
        if (typeHierarchy.length === 0){
            typeHierarchy = ['HierarchicalRequirement'];
        }

        var configs = [{
            find: {
                _TypeHierarchy: {$in: typeHierarchy},
                Children: null,
                Release: {$in: rOids} //We don't need project hierarchy here because the releases are associated with the current project hierarchy.
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
                        _TypeHierarchy: {$in: typeHierarchy},
                        Children: null,
                        _ItemHierarchy: {$in: piOids},
                        _ProjectHierarchy: projectOid // We need project hierarchy here to limit the stories and defects to just those in this project.
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
                backgroundColor: '#444',
                headerFormat: '<span style="display:block;margin:0;padding:0 0 2px 0;text-align:center"><b style="font-family:NotoSansBold;color:white;">{point.key}</b></span><table><tbody>',
                footerFormat: '</tbody></table>',
                pointFormat: '<tr><td class="tooltip-label"><span style="color:{series.color};width=100px;">\u25CF</span> {series.name}</td><td class="tooltip-point">{point.y}</td></tr>',
                shared: true,
                useHTML: true,
                borderColor: '#444'
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
    getSettingsFields: function(){
        var labelWidth = 200;

        return [{
            xtype: 'rallycheckboxfield',
            fieldLabel: 'Show Prediction Lines',
            labelAlign: 'right',
            labelWidth: labelWidth,
            name: 'showPredictionLines'
        },{
            xtype: 'rallycheckboxfield',
            fieldLabel: 'Show Defects',
            labelAlign: 'right',
            labelWidth: labelWidth,
            name: 'showDefects'
        },{
            xtype: 'rallycheckboxfield',
            fieldLabel: 'Show User Stories',
            labelAlign: 'right',
            labelWidth: labelWidth,
            name: 'showStories'
        }];
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

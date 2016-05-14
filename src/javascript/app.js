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
            showPlannedPredictionLine: false,
            showAcceptedPredictionLine: true,
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
            rcb.on('ready', this.updateTimebox, this);
        }
        var cb = headerBox.add({
            xtype: 'tscustomcombobox',
            itemId: 'cbUnit',
            allowedValues: this.chartUnits
        });
        cb.on('select',this._updateBurnup, this);
        if (this.isOnScopedDashboard()){
            this.updateTimebox();
        }
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
        this.logger.log('getTimeboxRecord', this.isOnScopedDashboard(), this.down(this.timeboxTypePicker) && this.down(this.timeboxTypePicker).getRecord())
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
    _getChartColors: function(){
        //In order to keep the colors consistent for the different options,
        //we need to build the colors according to the settings
        var chartColors = [],
            numCompletedStates = this.completedStates.length;

        if (this.getShowStories()){
            chartColors.push('#8DC63F');
        }
        if (this.getShowDefects()){
            chartColors.push('#FBB990');
        }
        if (numCompletedStates > 1){
            if (this.getShowStories()){
                chartColors.push('#1E7C00');
            }
            if (this.getShowDefects()){
                chartColors.push('#FF8200');
            }
        }
        chartColors.push('#7CAFD7');
        if (this.getShowPlannedPredictionLine()){
            chartColors.push('#666');
        }
        if (this.getShowAcceptedPredictionLine()){
            chartColors.push('#005EB8');
        }
        return chartColors;
    },
    _updateBurnup: function(){
        this.logger.log('_updateBurnup', this.getUnit());

        this.down('#displayBox').removeAll();

        if (!this.timeboxes || this.timeboxes.length === 0){
            this._showMissingCriteria();
            return;
        }

        this.down('#displayBox').add({
            xtype: 'rallychart',
            chartColors: this._getChartColors(),
            storeType: 'Rally.data.lookback.SnapshotStore',
            storeConfig: this._getStoreConfig(),
            calculatorType: 'Rally.technicalservices.ReleaseBurnupCalculator',
            calculatorConfig: {
                usePoints: this.getUnit() === 'Points',
                completedScheduleStateNames: this.completedStates,
                startDate: this.getTimeboxStartDate(),
                endDate: this.getTimeboxEndDate(),
                showPlannedPredictionLine: this.getShowPlannedPredictionLine(),
                showAcceptedPredictionLine: this.getShowAcceptedPredictionLine(),
                showDefects: this.getShowDefects(),
                showStories: this.getShowStories()
                //preliminaryEstimateValueHashByObjectID: this.preliminaryEstimateValueHashByObjectID
            },
            chartConfig: this._getChartConfig()
        });
    },
    getBooleanSetting: function(settingName){
        return this.getSetting(settingName) === 'true' || this.getSetting(settingName) === true;
    },
    getShowPlannedPredictionLine: function(){
        return this.getBooleanSetting('showPlannedPredictionLine');
    },
    getShowAcceptedPredictionLine: function(){
        return this.getBooleanSetting('showAcceptedPredictionLine');
    },
    getShowDefects: function(){
        return this.getBooleanSetting('showDefects');
    },
    getShowStories: function(){
        var showStories = this.getBooleanSetting('showStories');
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
            fetch: ['ScheduleState', 'PlanEstimate','_id','_TypeHierarchy'],
            hydrate: ['ScheduleState','_TypeHierarchy'],
            removeUnauthorizedSnapshots: true,
            sort: {
                _ValidFrom: 1
            },
            context: this.getContext().getDataContext(),
            limit: Infinity
        }];

        piOids = piOids.slice(-10);
        this.logger.log('PortfolioItems', piOids.length);
        if (piOids && piOids.length > 0){


            configs.push({
                find: {
                        _TypeHierarchy: {$in: typeHierarchy},
                        Children: null,
                        _ItemHierarchy: {$in: piOids},
                        _ProjectHierarchy: projectOid // We need project hierarchy here to limit the stories and defects to just those in this project.
                },
                fetch: ['ScheduleState', 'PlanEstimate','_id','_TypeHierarchy'],
                hydrate: ['ScheduleState','_TypeHierarchy'],
                compress: true,
                removeUnauthorizedSnapshots: true,
                sort: {
                    _ValidFrom: 1
                },
                //context: this.getContext().getDataContext(),
                limit: Infinity
            });
        }
        return configs;
    },
    _getChartConfig: function(){
        var numTicks = 6;
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
                    },
                    formatter: function(){
                        var d = new Date(this.value);
                        return Rally.util.DateTime.format(d, 'm/d/Y');
                    }
                },
                tickPositioner: function () {
                    var positions = [],
                        tick = Math.floor(this.dataMin),
                        increment = Math.ceil((this.dataMax - this.dataMin) / numTicks);

                    if (this.dataMax !== null && this.dataMin !== null) {
                        for (tick; tick - increment <= this.dataMax; tick += increment) {
                            positions.push(tick);
                        }
                    }
                    return positions;
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
                    },
                    min: 0
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
            fieldLabel: 'Show Planned Prediction Line',
            labelAlign: 'right',
            labelWidth: labelWidth,
            name: 'showPlannedPredictionLine'
        },{
            xtype: 'rallycheckboxfield',
            fieldLabel: 'Show Accepted Prediction Line',
            labelAlign: 'right',
            labelWidth: labelWidth,
            name: 'showAcceptedPredictionLine'
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

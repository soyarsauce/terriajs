"use strict";

/*global require*/
var URI = require('urijs');

var buildModuleUrl = require('terriajs-cesium/Source/Core/buildModuleUrl');
var CesiumEvent = require('terriajs-cesium/Source/Core/Event');
var Clock = require('./Clock');
var combine = require('terriajs-cesium/Source/Core/combine');
var DataSourceCollection = require('terriajs-cesium/Source/DataSources/DataSourceCollection');
var defaultValue = require('terriajs-cesium/Source/Core/defaultValue');
var defined = require('terriajs-cesium/Source/Core/defined');
var DeveloperError = require('terriajs-cesium/Source/Core/DeveloperError');
var Feature = require('./Feature');
var knockout = require('terriajs-cesium/Source/ThirdParty/knockout');
var loadJson5 = require('../Core/loadJson5');
var queryToObject = require('terriajs-cesium/Source/Core/queryToObject');
var Rectangle = require('terriajs-cesium/Source/Core/Rectangle');
var when = require('terriajs-cesium/Source/ThirdParty/when');
var isCommonMobilePlatform = require('../Core/isCommonMobilePlatform');

var CameraView = require('./CameraView');
var Catalog = require('./Catalog');
var ConsoleAnalytics = require('../Core/ConsoleAnalytics');
var CorsProxy = require('../Core/CorsProxy');
var ServerConfig = require('../Core/ServerConfig');
var GoogleAnalytics = require('../Core/GoogleAnalytics');
var NowViewing = require('./NowViewing');
var Promise = require('../Core/Promise');
var Services = require('./Services');
var ViewerMode = require('./ViewerMode');
var NoViewer = require('./NoViewer');
var TimeSeriesStack = require('./TimeSeriesStack');
var hashEntity = require('../Core/hashEntity');

var defaultConfigParameters = {
    defaultMaximumShownFeatureInfos: 100,
    /* These services are not included within Terria, but this is where we expect them to be, by default. */
    regionMappingDefinitionsUrl: 'data/regionMapping.json',
    conversionServiceBaseUrl: 'convert/',
    proj4ServiceBaseUrl: 'proj4/',
    corsProxyBaseUrl: 'proxy/',
    proxyableDomainsUrl: 'proxyabledomains/',
    shareUrl: 'share',
    feedbackUrl: undefined
};

/**
 * The overall model for TerriaJS.
 * @alias Terria
 * @constructor
 *
 * @param {Object} options Object with the following properties:
 * @param {String} options.baseUrl The base directory in which TerriaJS can find its static assets.
 * @param {String} [options.cesiumBaseUrl='(options.baseUrl)/build/Cesium/build/'] The base directory in which Cesium can find its static assets.
 * @param {String} [options.appName] The name of the app.
 * @param {String} [options.supportEmail] The support email for the app.
 * @param {AddressGeocoder} [options.batchGeocoder] Geocoder to use for geocoding addresses in CSV files.
 */
var Terria = function(options) {
    // IE9 doesn't have a console object until the debugging tools are opened.
    // Add a shim.
    if (typeof window.console === 'undefined') {
        window.console = {
            log: function() {},
            warn: function() {}
        };
    }
    // Polyfill Promise for old browsers
    if (!defined(window.Promise)) {
        window.Promise = Promise;
    }

    if (!defined(options) || !defined(options.baseUrl)) {
        throw new DeveloperError('options.baseUrl is required.');
    }

    this.baseUrl = defaultValue(options.baseUrl, 'build/TerriaJS/');
    if (this.baseUrl.lastIndexOf('/') !== this.baseUrl.length - 1) {
        this.baseUrl += '/';
    }

    var cesiumBaseUrl = defaultValue(options.cesiumBaseUrl, this.baseUrl + 'build/Cesium/build/');
    if (cesiumBaseUrl.lastIndexOf('/') !== cesiumBaseUrl.length - 1) {
        cesiumBaseUrl += '/';
    }
    this.cesiumBaseUrl = cesiumBaseUrl;
    buildModuleUrl.setBaseUrl(cesiumBaseUrl);

    /**
     * Gets or sets the instance to which to report Google Analytics-style log events.
     * If a global `ga` function is defined, this defaults to `GoogleAnalytics`.  Otherwise, it defaults
     * to `ConsoleAnalytics`.
     * @type {ConsoleAnalytics|GoogleAnalytics}
     */
    this.analytics = options.analytics;
    if (!defined(this.analytics)) {
        if (typeof window !== 'undefined' && defined(window.ga)) {
            this.analytics = new GoogleAnalytics();
        } else {
            this.analytics = new ConsoleAnalytics();
        }
    }

    /**
     * The name of the app to be built upon Terria. This will appear in error messages to the user.
     * @type {String}
     * @default "TerriaJS App"
     */
    this.appName = defaultValue(options.appName, "TerriaJS App");

    /**
     * The support email for the app to be built upon Terria. This will appear in error messages to the user.
     * @type {String}
     * @default "support@terria.io"
     */
    this.supportEmail = defaultValue(options.supportEmail, "support@terria.io");

    /**
     * Indicates whether time-dynamic layers should start animating immediately upon load.
     * If false, the user will need to press play manually before the layer starts animating.
     * @type {Boolean}
     * @default true
     */
    this.autoPlay = true;

    /**
     * The geocoder to use for batch geocoding addresses in CSV files.
     * @type {AddressGeocoder}
     */
    this.batchGeocoder = options.batchGeocoder;

    /**
     * An event that is raised when a user-facing error occurs.  This is especially useful for errors that happen asynchronously and so
     * cannot be raised as an exception because no one would be able to catch it.  Subscribers are passed the {@link TerriaError}
     * that occurred as the only function parameter.
     * @type {CesiumEvent}
     */
    this.error = new CesiumEvent();

    /**
     * Gets or sets the map mode.
     * @type {ViewerMode}
     */
    this.viewerMode = defaultValue(options.viewerMode, ViewerMode.CesiumTerrain);

    /**
     * Gets or sets the current base map.
     * @type {ImageryLayerCatalogItem}
     */
    this.baseMap = undefined;

    /**
     * Gets or sets the current fog settings, used in the Cesium Scene/Fog constructor.
     * @type {Object}
     */
    this.fogSettings = undefined;

    /**
     * Gets or sets the name of the base map to use.
     * @type {String}
     */
    this.baseMapName = undefined;

    /**
     * Gets or sets a color that contrasts well with the base map.
     * @type {String}
     */
    this.baseMapContrastColor = '#ffffff';

    /**
     * Gets or sets the event that is raised just before switching between Cesium and Leaflet.
     * @type {Event}
     */
    this.beforeViewerChanged = new CesiumEvent();

    /**
     * Gets or sets the event that is raised just after switching between Cesium and Leaflet.
     * @type {Event}
     */
    this.afterViewerChanged = new CesiumEvent();

    /**
     * Gets or sets the collection of Cesium-style data sources that are currently active on the map.
     * @type {DataSourceCollection}
     */
    this.dataSources = new DataSourceCollection();

    /**
     * Gets or sets the clock that controls how time-varying data items are displayed.
     * @type {Clock}
     */
    this.clock = new Clock({
        shouldAnimate: false
    });

    this.timeSeriesStack = new TimeSeriesStack(this.clock);

    // See the intialView property below.
    this._initialView = undefined;

    /**
     * Gets or sets the camera's home view.  The home view is the one that the application
     * returns to when the user clicks the "Reset View" button in the Navigation widget.  It is also used
     * as the {@link Terria#initialView} if one is not specified.
     * @type {CameraView}
     */
    this.homeView = new CameraView(Rectangle.MAX_VALUE);

    /**
     * Gets or sets a value indicating whether the application should automatically zoom to the new view when
     * the {@link Terria#initialView} (or {@link Terria#homeView} if no initial view is specified).
     * @type {Boolean}
     * @default true
     */
    this.zoomWhenInitialViewChanges = true;

    /**
     * Gets or sets the {@link this.corsProxy} used to determine if a URL needs to be proxied and to proxy it if necessary.
     * @type {CorsProxy}
     */
    this.corsProxy = new CorsProxy();

    /**
     * Gets or sets properties related to the Cesium globe.  If the application is in 2D mode, this property will be
     * undefined and {@link Terria#leaflet} will be set.
     * @type {Cesium}
     */
    this.cesium = undefined;

    /**
     * Gets or sets properties related to the Leaflet map.  If the application is in 3D mode, this property will be
     * undefined and {@link Terria#cesium} will be set.
     * @type {Leaflet}
     */
    this.leaflet = undefined;

    /**
     * Gets or sets a reference to either {@link Terria#cesium} or {@link Terria#leaflet},
     * whichever is currently in use.
     * @type {Cesium|Leaflet}
     */
    this._noViewer = new NoViewer(this);
    this.currentViewer = this._noViewer;

    /**
     * Gets or sets the collection of user properties.  User properties
     * can be set by specifying them in the hash portion of the URL.  For example, if the application URL is
     * `http://localhost:3001/#foo=bar&someproperty=true`, this object will contain a property named 'foo' with the
     * value 'bar' and a property named 'someproperty' with the value 'true'. Currently recognised URL parameters include
     * 'map=[2D,3D]' (choose the Leaflet or Cesium view) and `mode=preview` (suppress warnings, when used as an embedded
     * previewer).
     * @type {Object}
     */
    this.userProperties = {};

    /**
     * Gets or sets the list of sources from which the catalog was populated.  A source may be a string, in which case it
     * is expected to be a URL of an init file (like init_nm.json), or it can be a JSON-style object literal which is
     * the init content itself.
     * @type {Array}
     */
    this.initSources = [];

    /**
     * Gets or sets the features that are currently picked.
     * @type {PickedFeatures}
     */
    this.pickedFeatures = undefined;

    /**
     * Gets or sets the stack of map interactions modes.  The mode at the top of the stack
     * (highest index) handles click interactions with the map
     * @type {MapInteractionMode[]}
     */
    this.mapInteractionModeStack = [];

    /**
     * Gets or sets the catalog of geospatial data.
     * @type {Catalog}
     */
    this.catalog = new Catalog(this);

    /**
     * Gets or sets the add-on services known to the application.
     * @type {Services}
     */
    this.services = new Services(this);

    /**
     * Gets or sets the collection of geospatial data that is currently enabled.
     * @type {NowViewing}
     */
    this.nowViewing = new NowViewing(this);

    /**
     * Gets or sets the currently-selected feature, or undefined if there is no selected feature.  The selected
     * feature is highlighted by drawing a targetting cursor around it.
     * @type {Entity}
     */
    this.selectedFeature = undefined;

    /**
     * Gets or sets the configuration parameters set at startup.
     * Contains:
     * * regionMappingDefinitionsUrl: URL of JSON file containing region mapping definitions
     * * conversionServiceBaseUrl: URL of OGR2OGR conversion service
     * * proj4ServiceBaseUrl: URL of proj4def lookup service
     * * corsProxyBaseUrl: URL of CORS proxy
     * @type {Object}
     */
    this.configParameters = defaultConfigParameters;

    /**
     * Gets or sets the urlShorter to be used with terria.  This is currently set in the start method
     * to allow the urlShortener object to properly initialize.  See the GoogleUrlShortener for an
     * example urlShortener.
     * @type {Object}
     */
    this.urlShortener = undefined;

    /**
     * Gets or sets the shareDataService to be used with Terria, which can save JSON or (in future) other user-provided
     * data somewhere. It can be used to generate short URLs.
     * @type {Object}
     */
    this.shareDataService = undefined;

    /**
     * Gets or sets the ServerConfig object representing server-side configuration.
     * @type {Object}
     */
    this.serverConfig = undefined;

    /**
     * Event that tracks changes to the progress in loading new tiles from either Cesium or Leaflet - events will be
     * raised with the number of tiles that still need to load.
     *
     * @type {CesiumEvent}
     */
    this.tileLoadProgressEvent = new CesiumEvent();

    this.disclaimerListener = function(catalogMember, callback) {
        window.alert(catalogMember.initialMessage.content); /*eslint no-alert: 0*/
        callback();
    };

    /**
     * Gets or sets the selectBox function - set true when user requires a rectangle parameter from analytics.
     * @type {Boolean}
     */
    this.selectBox = false;

    /**
     * Gets or sets a callback function that can modify any "start data" (e.g. a share URL) before it is loaded.
     * The function is passed the start data and may modify it in place or return a new instance.
     * @type {Function}
     */
    this.filterStartDataCallback = undefined;

    // TODO: Why track showTimeline, which doesn't appear anywhere in the code (in this file or any other)?
    knockout.track(this, ['viewerMode', 'baseMap', 'baseMapName', 'fogSettings', '_initialView', 'homeView', 'pickedFeatures', 'selectedFeature', 'mapInteractionModeStack', 'configParameters', 'showTimeline', 'catalog', 'selectBox']);

    /**
     * Gets or sets the camera's initial view.  This is the view that the application has at startup.  If this property
     * is not explicitly specified, the {@link Terria#homeView} is used.
     * @type {CameraView}
     */
    knockout.defineProperty(this, 'initialView', {
        get: function() {
            if (this._initialView) {
                return this._initialView;
            } else {
                return this.homeView;
            }
        },
        set: function(value) {
            this._initialView = value;
        }
    });

    knockout.getObservable(this, 'initialView').subscribe(function() {
        if (this.zoomWhenInitialViewChanges && defined(this.currentViewer)) {
            this.currentViewer.zoomTo(this.initialView, 2.0);
        }
    }, this);
};

/**
 * Starts up Terria.
 *
 * @param {Object} options Object with the following properties:
 * @param {String} [options.applicationUrl] The URL of the application.  Typically this is obtained from window.location.  This URL, if
 *                                          supplied, is parsed for startup parameters.
 * @param {String} [options.configUrl='config.json'] The URL of the file containing configuration information, such as the list of domains to proxy.
 * @param {UrlShortener} [options.urlShortener] The URL shortener to use to expand short URLs.  If this property is undefined, short URLs will not be expanded.
 * @param {Boolean} [options.persistViewerMode] Whether to use the ViewerMode stored in localStorage if avaliable (this takes priority over other ViewerMode options). If not specified the stored ViewerMode will be used.
 */
Terria.prototype.start = function(options) {
    function slashify(url) {
        return (url && url[url.length - 1] !== '/') ? url + '/' : url;
    }

    this.catalog.isLoading = true;

    var applicationUrl = defaultValue(options.applicationUrl, '');
    this.urlShortener = options.urlShortener;
    this.shareDataService = options.shareDataService;


    var that = this;
    return loadJson5(options.configUrl).then(function(config) {
        if (defined(config.parameters)) {
            // allow config file to provide TerriaJS-Server URLs to facilitate purely static deployments relying on external services
            that.configParameters = combine(config.parameters, that.configParameters);
        }
        var cp = that.configParameters;
        cp.conversionServiceBaseUrl = slashify(cp.conversionServiceBaseUrl);
        cp.proj4ServiceBaseUrl = slashify(cp.proj4ServiceBaseUrl);
        cp.corsProxyBaseUrl = slashify(cp.corsProxyBaseUrl);

        that.appName = defaultValue(cp.appName, defaultValue(options.appName, that.appName));
        that.supportEmail = defaultValue(cp.supportEmail, defaultValue(options.supportEmail, that.supportEmail));

        that.autoPlay = cp.autoPlay;

        that.analytics.start(that.configParameters);
        that.analytics.logEvent('launch', 'url', defined(applicationUrl.href) ? applicationUrl.href : 'empty');

        var initializationUrls = config.initializationUrls;

        if (defined(initializationUrls)) {
            for (var i = 0; i < initializationUrls.length; i++) {
                that.initSources.push(generateInitializationUrl(initializationUrls[i]));
            }
        }

        showDisclaimer(that, options.globalDisclaimerHtml, options.developmentDisclaimerPreambleHtml);

        that.serverConfig = new ServerConfig();
        let serverConfig;
        return that.serverConfig.init(cp.serverConfigUrl).then(function() {
            // All the "proxyableDomains" bits here are due to a pre-serverConfig mechanism for whitelisting domains.
            // We should deprecate it.
            var pdu = that.configParameters.proxyableDomainsUrl;
            if (pdu) {
                return loadJson5(pdu);
            }
        }).then(function(proxyableDomains) {
            if (proxyableDomains) {
                // format of proxyableDomains JSON file slightly differs from serverConfig format.
                proxyableDomains.allowProxyFor = proxyableDomains.allowProxyFor || proxyableDomains.proxyableDomains;
            }
            if (typeof that.serverConfig === 'object') {
                serverConfig = that.serverConfig.config; // if server config is unavailable, this remains undefined.
            }
            if (that.shareDataService) {
                that.shareDataService.init(serverConfig);
            }
            that.corsProxy.init(proxyableDomains || serverConfig, cp.corsProxyBaseUrl, config.proxyDomains);
        }).otherwise(function(e) {
            console.error(e);
            // There's no particular reason an error should be thrown here.
            // that.error.raiseEvent({
            //     title: 'Failed to initialize services',
            //     message: 'A problem occurred with the Terria server. This may cause some layers or the conversion service to be unavailable.'
            // });
        }).then(function() {
            return that.updateApplicationUrl(applicationUrl, that.urlShortener);
        }).then(function () {
            var persistViewerMode = defaultValue(options.persistViewerMode, true);

            if (persistViewerMode && defined(that.getLocalProperty('viewermode'))) {
                that.viewerMode = parseInt(that.getLocalProperty('viewermode'), 10);
            } else {
                // If we are running on a mobile platform set the viewerMode to the config specified default mobile viewer mode.
                if (isCommonMobilePlatform() && !defined(that.userProperties.map)) {
                    // This is the default viewerMode to use if the configuration parameter is not set or is not set correctly.
                    that.viewerMode = ViewerMode.Leaflet;

                    if (defined(that.configParameters.mobileDefaultViewerMode) && (typeof that.configParameters.mobileDefaultViewerMode === 'string')) {
                        const mobileDefault = that.configParameters.mobileDefaultViewerMode.toLowerCase();
                        if (mobileDefault === '3dterrain') {
                            that.viewerMode = ViewerMode.CesiumTerrain;
                        }
                        else if (mobileDefault === '3dsmooth') {
                            that.viewerMode = ViewerMode.CesiumEllipsoid;
                        }
                        else if (mobileDefault === '2d') {
                            that.viewerMode = ViewerMode.Leaflet;
                        }
                    }
                }

                if (options.defaultTo2D && !defined(that.userProperties.map)) {
                    that.viewerMode = ViewerMode.Leaflet;
                }
            }

            that.catalog.isLoading = false;
        }).otherwise(function(e) {
            console.error('Error from updateApplicationUrl: ',  e);
            that.error.raiseEvent({
                title: 'Problem loading URL',
                message: 'A problem occurred while initialising Terria with URL parameters.'
            });
        });
    });
};

/**
 * Updates the state of the application based on the hash portion of a URL.
 * @param {String} newUrl The new URL of the application.
 * @return {Promise} A promise that resolves when any new init sources specified in the URL have been loaded.
 */
Terria.prototype.updateApplicationUrl = function(newUrl) {
    var uri = new URI(newUrl);
    var hash = uri.fragment();
    var hashProperties = queryToObject(hash);

    var initSources = this.initSources.slice();
    var promise = interpretHash(this, hashProperties, this.userProperties, this.initSources, initSources);

    var that = this;
    return when(promise).then(function() {
        if (that.userProperties.map === '2d') {
            that.viewerMode = ViewerMode.Leaflet;
        } else if (that.userProperties.map === '3d') {
            that.viewerMode = ViewerMode.CesiumTerrain;
        }
        return loadInitSources(that, initSources);
    });
};

Terria.prototype.updateFromStartData = function(startData) {
    var initSources = this.initSources.slice();
    interpretStartData(this, startData, this.initSources, initSources);
    return loadInitSources(this, initSources);
};

/**
 * Gets the value of a user property.  If the property doesn't exist, it is created as an observable property with the
 * value undefined.  This way, if it becomes defined in the future, anyone depending on the value will be notified.
 * @param {String} propertyName The name of the user property for which to get the value.
 * @return {Object} The value of the property, or undefined if the property does not exist.
 */
Terria.prototype.getUserProperty = function(propertyName) {
    if (!knockout.getObservable(this.userProperties, propertyName)) {
        this.userProperties[propertyName] = undefined;
        knockout.track(this.userProperties, [propertyName]);
    }
    return this.userProperties[propertyName];
};

Terria.prototype.addInitSource = function(initSource) {
    var promise = when();

    // Extract the list of CORS-ready domains.
    if (defined(initSource.corsDomains)) {
        this.corsProxy.corsDomains.push.apply(this.corsProxy.corsDomains, initSource.corsDomains);
    }

    // The last init source to specify an initial/home camera view wins.
    if (defined(initSource.homeCamera)) {
        this.homeView = CameraView.fromJson(initSource.homeCamera);
    }

    if (defined(initSource.initialCamera)) {
        this.initialView = CameraView.fromJson(initSource.initialCamera);
    }

    if (defined(initSource.fogSettings)) {
        this.fogSettings = initSource.fogSettings;
    }

    if (defined(initSource.baseMapName)) {
        this.baseMapName = initSource.baseMapName;
    }

    if (defined(initSource.viewerMode) && !defined(this.userProperties.map)) {
        if (initSource.viewerMode === '2d') {
            this.viewerMode = ViewerMode.Leaflet;
        } else if (initSource.viewerMode === '3d') {
            this.viewerMode = ViewerMode.CesiumTerrain;
        }
    }

    if (defined(initSource.currentTime)) {
        // If the time is supplied we want to freeze the display at the specified time and not auto playing.
        this.autoPlay = false;

        const time = initSource.currentTime;
        this.clock.currentTime.dayNumber = parseInt(time.dayNumber, 10);
        this.clock.currentTime.secondsOfDay = parseInt(time.secondsOfDay, 10);
    }

    // Populate the list of services.
    if (defined(initSource.services)) {
        this.services.services.push.apply(this.services, initSource.services);
    }

    // Populate the catalog
    if (defined(initSource.catalog)) {
        var isUserSupplied = !initSource.isFromExternalFile;

        promise = promise.then(this.catalog.updateFromJson.bind(this.catalog, initSource.catalog, {
            isUserSupplied: isUserSupplied
        }));
    }

    if (defined(initSource.sharedCatalogMembers)) {
        promise = promise.then(this.catalog.updateByShareKeys.bind(this.catalog, initSource.sharedCatalogMembers));
    }

    var that = this;

    if (defined(initSource.pickedFeatures)) {
        promise.then(function() {
            var removeViewLoadedListener;

            var loadPickedFeatures = function() {
                if (defined(removeViewLoadedListener)) {
                    removeViewLoadedListener();
                }

                var vectorFeatures;
                var featureIndex = {};

                var initSourceEntities = initSource.pickedFeatures.entities;
                if (initSourceEntities) {
                    // Build index of terria features by a hash of their properties.
                    var relevantItems = that.nowViewing.items.filter(function(item) {
                        return item.isEnabled && item.isShown && defined(item.dataSource) && defined(item.dataSource.entities);
                    });
                    relevantItems.forEach(function(item) {
                        (item.dataSource.entities.values || []).forEach(function(entity) {
                            var hash = hashEntity(entity, that.clock);
                            var feature = Feature.fromEntityCollectionOrEntity(entity);
                            featureIndex[hash] = featureIndex[hash] ? featureIndex[hash].concat([feature]) : [feature];
                        });
                    });

                    // Go through the features we've got from terria match them up to the id/name info we got from the
                    // share link, filtering out any without a match.
                    vectorFeatures = initSourceEntities.map(function(initSourceEntity) {
                        var matches = defaultValue(featureIndex[initSourceEntity.hash], [])
                            .filter(function(match) {
                                return match.name === initSourceEntity.name;
                            });

                        return matches.length && matches[0];
                    }).filter(function(feature) {
                        return defined(feature);
                    });
                }

                that.currentViewer.pickFromLocation(initSource.pickedFeatures.pickCoords, initSource.pickedFeatures.providerCoords, vectorFeatures);

                that.pickedFeatures.allFeaturesAvailablePromise.then(function() {
                    that.pickedFeatures.features.forEach(function(entity) {
                        var hash = hashEntity(entity, that.clock);
                        var feature = entity;
                        featureIndex[hash] = featureIndex[hash] ? featureIndex[hash].concat([feature]) : [feature];
                    });

                    if (defined(initSource.pickedFeatures.current)) {
                        var selectedFeatureMatches = defaultValue(featureIndex[initSource.pickedFeatures.current.hash], [])
                            .filter(function(feature) {
                                return feature.name === initSource.pickedFeatures.current.name;
                            });

                        that.selectedFeature = selectedFeatureMatches.length && selectedFeatureMatches[0];
                    }
                });
            };


            if (that.currentViewer !== that._noViewer) {
                loadPickedFeatures();
            } else {
                removeViewLoadedListener = that.afterViewerChanged.addEventListener(loadPickedFeatures);
            }
        });
    }

    return promise;
};

Terria.prototype.getLocalProperty = function(key) {
    try {
        if (!defined(window.localStorage)) {
            return undefined;
        }
    } catch (e) {
        // SecurityError can arise if 3rd party cookies are blocked in Chrome and we're served in an iFrame
        return undefined;
    }
    var v = window.localStorage.getItem(this.appName + '.' + key);
    if (v === 'true') {
        return true;
    } else if (v === 'false') {
        return false;
    }
    return v;
};

Terria.prototype.setLocalProperty = function(key, value) {
    try {
        if (!defined(window.localStorage)) {
            return undefined;
        }
    } catch (e) {
        return undefined;
    }
    window.localStorage.setItem(this.appName + '.' + key, value);
    return true;
};

var latestStartVersion = '0.0.05';

function interpretHash(terria, hashProperties, userProperties, persistentInitSources, temporaryInitSources) {
    var promise;
    // #share=xyz . Resolve with either share data service or URL shortener.
    if (defined(hashProperties.share)) {
        if (defined(terria.shareDataService)) {
            // get JSON directly
            promise = terria.shareDataService.resolveData(hashProperties.share);
        } else if (defined(terria.urlShortener)) {
            promise = terria.urlShortener.expand(hashProperties.share)
                // get URL, and extract the JSON part
                .then(longUrl => longUrl && queryToObject(new URI(longUrl).fragment()));
        }
    }

    return when(promise, function(shareProps) {
        Object.keys(hashProperties).forEach(function(property) {
            var propertyValue = hashProperties[property];

            if (property === 'clean') {
                persistentInitSources.length = 0;
                temporaryInitSources.length = 0;
            } else if (property === 'start') {
                // a share link that hasn't been shortened: JSON embedded in URL (only works for small quantities of JSON)
                var startData = JSON.parse(propertyValue);
                interpretStartData(terria, startData, persistentInitSources, temporaryInitSources);
            } else if (defined(propertyValue) && propertyValue.length > 0) {
                userProperties[property] = propertyValue;
                knockout.track(userProperties, [property]);
            } else {
                var initSourceFile = generateInitializationUrl(property);
                persistentInitSources.push(initSourceFile);
                temporaryInitSources.push(initSourceFile);
            }
        });
        if (shareProps) {
            interpretStartData(terria, shareProps, persistentInitSources, temporaryInitSources);
        }
    });
}

function interpretStartData(terria, startData, persistentInitSources, temporaryInitSources) {
    if (defined(startData.version) && startData.version !== latestStartVersion) {
        adjustForBackwardCompatibility(startData);
    }

    if (defined(terria.filterStartDataCallback)) {
        startData = terria.filterStartDataCallback(startData) || startData;
    }

    // Include any initSources specified in the URL.
    if (defined(startData.initSources)) {
        for (var i = 0; i < startData.initSources.length; ++i) {
            var initSource = startData.initSources[i];
            if (temporaryInitSources.indexOf(initSource) < 0) {
                temporaryInitSources.push(initSource);

                // Only add external files to the application's list of init sources.
                if (typeof initSource === 'string' && persistentInitSources.indexOf(initSource) < 0) {
                    persistentInitSources.push(initSource);
                }
            }
        }
    }
}

function generateInitializationUrl(url) {
    if (url.toLowerCase().substring(url.length - 5) !== '.json') {
        return 'init/' + url + '.json';
    }
    return url;
}

function loadInitSources(terria, initSources) {
    return initSources.reduce(function(promiseSoFar, initSource) {
        return promiseSoFar
            .then(loadInitSource.bind(undefined, terria, initSource))
            .then(function(initSource) {
                if (defined(initSource)) {
                    return terria.addInitSource(initSource);
                }
            });
    }, when());
}

function loadInitSource(terria, source) {
    if (typeof source === 'string') {
        return loadJson5(terria.corsProxy.getURLProxyIfNecessary(source))
            .then(function (initSource) {
                initSource.isFromExternalFile = true;
                return initSource;
            })
            .otherwise(function () {
                terria.error.raiseEvent({
                    title: 'Error loading initialization source',
                    message: 'An error occurred while loading initialization information from ' + source + '.  This may indicate that you followed an invalid link or that there is a problem with your Internet connection.'
                });
                return undefined;
            });
    } else {
        return source;
    }
}

function adjustForBackwardCompatibility(startData) {
    if (startData.version === '0.0.03') {
        // In this version, there was just a single 'camera' property instead of a 'homeCamera' and 'initialCamera'.
        // Treat the one property as the initialCamera.
        for (var i = 0; i < startData.initSources.length; ++i) {
            if (defined(startData.initSources[i].camera)) {
                startData.initSources[i].initialCamera = startData.initSources[i].camera;
                startData.initSources[i].camera = undefined;
            }
        }
    }
}

function showDisclaimer(terria, globalDisclaimerHtml, developmentDisclaimerPreambleHtml) {
    // Show a modal disclaimer before user can do anything else.
    if (defined(terria.configParameters.globalDisclaimer) && defined(globalDisclaimerHtml)) {
        var globalDisclaimer = terria.configParameters.globalDisclaimer;
        var hostname = window.location.hostname;
        var enabled = !defined(globalDisclaimer.enabled) || globalDisclaimer.enabled;
        if (enabled && (globalDisclaimer.enableOnLocalhost || hostname.indexOf('localhost') === -1)) {
            var message = '';
            // Sometimes we want to show a preamble if the user is viewing a site other than the official production instance.
            // This can be expressed as a devHostRegex ("any site starting with staging.") or a negative prodHostRegex ("any site not ending in .gov.au")
            if (defined(developmentDisclaimerPreambleHtml)) {
                if (defined(globalDisclaimer.devHostRegex) && hostname.match(globalDisclaimer.devHostRegex) ||
                    defined(globalDisclaimer.prodHostRegex) && !hostname.match(globalDisclaimer.prodHostRegex)) {
                        message += developmentDisclaimerPreambleHtml;
                }
            }

            message += globalDisclaimerHtml;

            var options = {
                title: (globalDisclaimer.title !== undefined) ? globalDisclaimer.title : 'Disclaimer',
                confirmText: (globalDisclaimer.buttonTitle || "I Agree"),
                width: globalDisclaimer.width || 600,
                height: globalDisclaimer.height || 550,
                message: message,
                hideUi: globalDisclaimer.hideUi
            };

            terria.error.raiseEvent(options);
        }
    }
}

module.exports = Terria;

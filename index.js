'use strict';

const bluebird = require('bluebird');
const debug = require('debug')('homebridge-telldus-pn');
const { LocalApi, LiveApi } = require('telldus-api');
const util = require('./util');

module.exports = function(homebridge) {
	const Service = homebridge.hap.Service;
	const Characteristic = homebridge.hap.Characteristic;
	let api;
	let isLocal;

	const modelDefinitions = [
		{
			model: 'selflearning-switch',
			definitions: [{ service: Service.Switch, characteristics: [ Characteristic.On ] }],
		},
		{
			model: 'codeswitch',
			definitions: [{ service: Service.Lightbulb, characteristics: [ Characteristic.On ] }],
		},
		{
			model: 'selflearning-dimmer',
			definitions: [{ service: Service.Lightbulb, characteristics: [ Characteristic.On, Characteristic.Brightness ] }],
		},
		{
			model: 'temperature',
			definitions: [{ service: Service.TemperatureSensor, characteristics: [ Characteristic.CurrentTemperature ] }],
		},
		// oregon protocol temperature sensor model
		{
			model: 'EA4C',
			definitions: [{ service: Service.TemperatureSensor, characteristics: [ Characteristic.CurrentTemperature ] }],
		},
		{
			model: 'temperaturehumidity',
			definitions: [
				{ service: Service.TemperatureSensor, characteristics: [ Characteristic.CurrentTemperature ] },
				{ service: Service.HumiditySensor, characteristics: [ Characteristic.CurrentRelativeHumidity ] }
			]
		},
		{
			model: '1A2D',
			definitions: [
				{ service: Service.TemperatureSensor, characteristics: [ Characteristic.CurrentTemperature ] },
				{ service: Service.HumiditySensor, characteristics: [ Characteristic.CurrentRelativeHumidity ] }
			]
		},
		{
			model: 'window-covering',
			definitions: [{ service: Service.WindowCovering, characteristics: [ Characteristic.CurrentPosition, Characteristic.TargetPosition, Characteristic.PositionState ] }],
		},
		{
			model: 'switch',
			definitions: [{ service: Service.Switch, characteristics: [ Characteristic.On ] }],
		},
		{
			model: '010f-0c02-1003',
			definitions: [{ service: Service.TemperatureSensor, characteristics: [ Characteristic.CurrentTemperature ] }],
		},
		{
			model: '019a-0003-000a',
			definitions: [
				{ service: Service.TemperatureSensor, characteristics: [ Characteristic.CurrentTemperature ] },
				{ service: Service.HumiditySensor, characteristics: [ Characteristic.CurrentRelativeHumidity ] }
			]
		},
		{
			model: '0060-0015-0001',
			definitions: [{ service: Service.TemperatureSensor, characteristics: [ Characteristic.CurrentTemperature ] }],
		},
		{
			model: '0154-0003-000a',
			definitions: [{ service: Service.Switch, characteristics: [ Characteristic.On ] }],
		},		
	];

	homebridge.registerPlatform("homebridge-telldus-pn", "Telldus", TelldusPlatform);

	function TelldusPlatform(log, config) {
		this.log = log;

		isLocal = !!config.local;

		log(`isLocal: ${isLocal}`);

		// The config
		if (isLocal) {
			const ipAddress = config.local.ip_address;
			const accessToken = config.local.access_token;
			if (!ipAddress) throw new Error('Please specify ip_address in config');
			if (!accessToken) throw new Error('Please specify access_token in config');

			api = new LocalApi({ host: ipAddress, accessToken });
		}
		else {
			const key = config["public_key"];
			const secret = config["private_key"];
			const tokenKey = config["token"];
			const tokenSecret = config["token_secret"];
			if (!key) throw new Error('Please specify public_key in config');
			if (!secret) throw new Error('Please specify private_key in config');
			if (!tokenKey) throw new Error('Please specify token in config');
			if (!tokenSecret) throw new Error('Please specify token_secret in config');

			api = new LiveApi({
				key,
				secret,
				tokenKey,
				tokenSecret,
			});
		}

		this.unknownAccessories = config["unknown_accessories"] || [];
	}

	function TelldusDevice(log, device, deviceConfig) {
		this.device = device;
		this.name = device.name;
		this.id = device.id;

		log(`Creating accessory with ID ${this.id}. Name from telldus: ${this.name}`);

		// Split manufacturer and model
		const modelSplit = (device.model || '').split(':');
		this.model = modelSplit[0] || 'unknown';
		this.manufacturer = modelSplit[1] || 'unknown';

		if (deviceConfig) {
			log(`Custom config found for ID ${deviceConfig.id}.`);
			if (deviceConfig.model) {
				log(`Custom model: '${deviceConfig.model}' overrides '${device.model}' from telldus`);
				this.model = deviceConfig.model;
			}
			if (deviceConfig.manufacturer) {
				log(`Custom manufacturer: '${deviceConfig.manufacturer}' overrides '${device.manufacturer}' from telldus`);
				this.manufacturer = deviceConfig.manufacturer;
			}
			if (deviceConfig.name) {
				log(`Custom name: '${deviceConfig.name}' overrides '${device.name}' from telldus`);
				this.name = deviceConfig.name;
			}
		}

		// Device log
		this.log = function(string) {
			log("[" + this.name + "] " + string);
		};
	}

	TelldusPlatform.prototype = {
		accessories: function(callback) {
			this.log("Loading accessories...");

			this.getAccessories()
				.then(accessories => {
					const uniqueAccessories = [...new Map(accessories.map(item => [item.id, item])).values()];
					callback(uniqueAccessories);
				})
				.catch(err => {
					this.log(err.message);
					throw err;
				});
		},
		getAccessories: function() {
			const processedDevices = new Set();
			const createDevice = (device) => {
				// Check if the device has already been processed
				if (processedDevices.has(device.id)) {
					this.log(`Device ${device.id} has already been processed, skipping`);
					return null;
				}

				processedDevices.add(device.id);
				// If we are running against local API, ID's are different
				const deviceConfig = isLocal
					// https://github.com/jchnlemon/homebridge-telldus/issues/56
					? this.unknownAccessories.find(a => a.local_id == device.id && ((!a.type && !device.type) || a.type === device.type))
					: this.unknownAccessories.find(a => a.id == device.id)

				if ((deviceConfig && deviceConfig.disabled)) {
					this.log(`Device ${device.id} is disabled, ignoring`);
					return;
				}

				if (!device.name) {
					this.log(`Device ${device.id} has no name from telldus, ignoring`);
					return;
				}

				return new TelldusDevice(this.log, device, deviceConfig);
			};

			return api.listSensors()
        .then(sensors => {
			debug('getSensors response', sensors);
          	this.log(`Found ${sensors.length} sensors in telldus live.`);

				return sensors.map(sensor => createDevice(sensor)).filter(sensor => sensor);
        })
				.then(sensors => {
					return api.listDevices()
						.then(devices => {
							debug('getDevices response', devices);
							this.log(`Found ${devices.length} devices in telldus live.`);

							// Only supporting type 'device'
							const filtered = devices.filter(s => s.type === 'device');

							return bluebird.mapSeries(filtered, device => api.getDeviceInfo(device.id));
						})
						.then(devices => {
							debug('getDeviceInfo responses', devices);
							return devices.map(device => createDevice(device)).filter(sensor => sensor);
						})
						.then(devices => sensors.concat(devices));
				});
		}
	};

	TelldusDevice.prototype = {
		// Respond to identify request
		identify: function(callback) {
			this.log("Hi!");
			callback();
		},

		getServices: function() {
			// Accessory information
			const accessoryInformation = new Service.AccessoryInformation();

			accessoryInformation
				.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
				.setCharacteristic(Characteristic.Model, this.model)
				.setCharacteristic(Characteristic.SerialNumber, this.id);

			const modelDefinition = modelDefinitions.find(d => d.model === this.model);

			let services = [];

			if (modelDefinition) {
				services = modelDefinition.definitions.map(this.configureServiceCharacteristics.bind(this));
			}
			else {
				this.log(
					`Your device (model ${this.device.model}, id ${this.id}) is not auto detected from telldus live. Please add the following to your config, under telldus platform (replace MODEL with a valid type, and optionally set manufacturer):\n` +
					`"unknown_accessories": [{ "id": ${this.id}, "model": "MODEL", "manufacturer": "unknown" }]\n` +
					`Valid models are: ${modelDefinitions.map(d => d.model).join(', ')}`
				);
			}

			return [accessoryInformation].concat(services);
		},

		configureServiceCharacteristics: function(definition) {
			const service = new definition.service(this.name);
			const characteristics = definition.characteristics;

			characteristics.forEach(characteristic => {
				const cx = service.getCharacteristic(characteristic);

				if (cx instanceof Characteristic.SecuritySystemCurrentState) {
					cx.getValueFromDev = dev => {
						if (dev.state == 2) return 3;
						if (dev.state == 16 && dev.statevalue !== "unde") return parseInt(dev.statevalue);
						return 2;
					};

					cx.on('get', (callback) => {
						bluebird.resolve(api.getDeviceInfo(this.device.id)).asCallback((err, cdevice) => {
							if (err) return callback(err);
							this.log("Getting current state for security " + cdevice.name + " [" + (cx.getValueFromDev(cdevice) == 3 ? "disarmed" : "armed") + "]");
							bluebird.delay(1000) //API Delay
							callback(false, cx.getValueFromDev(cdevice));
						});
					});

					cx.on('set', (state, callback) => {
						bluebird.resolve(api.dimDevice(this.device.id, state)).asCallback(err => {
							callback(err);
						});
					});
				}

				if (cx instanceof Characteristic.ContactSensorState) {
					cx.getValueFromDev = dev => dev.state == 1 ? 1 : 0;

					cx.on('get', (callback) => {
						bluebird.resolve(api.getDeviceInfo(this.device.id)).asCallback((err, cdevice) => {
							if (err) return callback(err);
							this.log("Getting state for switch " + cdevice.name + " [" + (cx.getValueFromDev(cdevice) == 1 ? "open" : "closed") + "]");
							callback(false, cx.getValueFromDev(cdevice));
						});
					});
				}

				if (cx instanceof Characteristic.CurrentTemperature) {
					cx.getValueFromDev = dev => {
						const tempData = (dev.data || []).find(d => d.name === "temp");
						if (tempData && tempData.value) {
							return parseFloat(tempData.value);
						} else {
							return NaN
						}
					}

					cx.on('get', (callback) => {
						bluebird.resolve(api.getSensorInfo(this.device.id)).asCallback((err, device) => {
							if (err) return callback(err);
							
							if (isNaN(cx.getValueFromDev(device))) {
								this.log("Getting temp for sensor " + device.name + " [0]");
								callback(false, 0);
							} else {
								this.log("Getting temp for sensor " + device.name + " [" + cx.getValueFromDev(device) + "]");
								callback(false, cx.getValueFromDev(device));
							}
						});
					});

					cx.setProps({
						minValue: -40,
						maxValue: 999
					});
				}

				if (cx instanceof Characteristic.CurrentRelativeHumidity) {
					cx.getValueFromDev = dev => {
						const humData = (dev.data || []).find (d => d.name === "humidity");
						if (humData && humData.value) {
							return parseFloat(humData.value);
						} else {
							return NaN
						}
					}

					cx.on('get', (callback) => {
						bluebird.resolve(api.getSensorInfo(this.device.id)).asCallback((err, device) => {
							if (err) return callback(err); 

							//ADDED THIS ROW TO BREAK AWAY FROM NaN 
							if (isNaN(cx.getValueFromDev(device))) {
								this.log("Getting humidity for sensor " + device.name + " [0]");
								callback(false, 0);	
							}else {
								this.log("Getting humidity for sensor " + device.name + " [" + cx.getValueFromDev(device) + "]");
								callback(false, cx.getValueFromDev(device));
							}
						});
					});

					cx.setProps({
						minValue: 0,
						maxValue: 100
					});
				}

				if (cx instanceof Characteristic.On) {
					cx.getValueFromDev = dev => dev.state != 2;

					cx.value = cx.getValueFromDev(this.device);

					cx.on('get', (callback) => {
						bluebird.resolve(api.getDeviceInfo(this.device.id)).asCallback((err, cdevice) => {
							if (err) return callback(err);
							this.log("Getting state for switch " + cdevice.name + " [" + (cx.getValueFromDev(cdevice) ? "on" : "off") + "]");

							if (Characteristic && Characteristic.Formats && cx.props) {
								switch (cx.props.format) {
								  case Characteristic.Formats.UINT8:
								  case Characteristic.Formats.INT:  // Fallback to INT if UINT8 is not defined
									callback(false, cx.getValueFromDev(cdevice) ? 1 : 0);
									break;
								  case Characteristic.Formats.BOOL:
									callback(false, cx.getValueFromDev(cdevice));
									break;
								  default:
									this.log("Unknown characteristic format");
									callback(false, cx.getValueFromDev(cdevice));
								}
							  } else {
								this.log("Characteristic Formats are undefined");
								callback(false, cx.getValueFromDev(cdevice));
							  }
						});
					});

					cx.on('set', (powerOn, callback) => {
						bluebird.resolve(api.getDeviceInfo(this.device.id)).asCallback((err, cdevice) => {
							if (err) return callback(err);
							bluebird.delay(1000) //API Delay
							// Don't turn on if already on for dimmer (prevents problems when dimming)
							// Because homekit sends both Brightness command and On command at the same time.
							const isDimmer = characteristics.indexOf(Characteristic.Brightness) > -1;
							if (powerOn && isDimmer && cx.getValueFromDev(cdevice)) return callback();

							bluebird.resolve(api.onOffDevice(this.device.id, powerOn)).asCallback(err => {
								callback(err);
							});
						});
					});
				}

				if (cx instanceof Characteristic.Brightness) {
					cx.getValueFromDev = dev => {
						if (dev.state == 1) return 100;
						if (dev.state == 16 && dev.statevalue !== "unde") return parseInt(dev.statevalue * 100 / 255);
						return 0;
					};

					cx.value = cx.getValueFromDev(this.device);

					cx.on('get', (callback) => {
						bluebird.resolve(api.getDeviceInfo(this.device.id)).asCallback((err, cdevice) => {
							if (err) return callback(err);
							this.log("Getting value for dimmer " + cdevice.name + " [" + cx.getValueFromDev(cdevice) + "]");
							bluebird.delay(1000) //API Delay
							callback(false, cx.getValueFromDev(cdevice));
						});
					});

					cx.on('set', (level, callback) => {
						api.dimDevice(this.device.id, util.percentageToBits(level))
							.then(() => bluebird.delay(1000)) // Try to prevent massive queuing of commands on the server
							.then(() => callback(), err => callback(err));
					});
				}

				if (cx instanceof Characteristic.CurrentPosition) {
					cx.on('get', callback => bluebird.try(() => {
						const resp = this.cachedValue || 0;
						this.log(`Get CurrentPosition ${resp}`);
						return resp;
					}).asCallback(callback));
				}

				if (cx instanceof Characteristic.PositionState) {
					cx.on('get', callback => bluebird.try(() => {
						this.log(`Get PositionState`);
						return 2;
					}).asCallback(callback));
				}

				if (cx instanceof Characteristic.TargetPosition) {
					cx.on('get', callback => bluebird.try(() => {
						const resp = this.cachedValue || 0;
						this.log(`Get TargetPosition ${resp}`);
						return resp;
					}).asCallback(callback));

					cx.on('set', (value, callback) => {
						this.cachedValue = value;

						const up = value > 0;
						this.log(`Door ${up ? 'up' : 'down'}`);
						bluebird.resolve(api.upDownDevice(this.device.id, up)
							.then(data => debug(data)))
							.then(() => bluebird.delay(1000)) //API Delay
							.asCallback(callback);
					});
				}
			});
			return service;
		}
	};
};

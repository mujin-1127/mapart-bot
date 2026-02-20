const printerManager = require('./PrinterManager');
const MapartPrinter = require('./MapartPrinter');
const BuildingPrinter = require('./BuildingPrinter');
const RedstonePrinter = require('./RedstonePrinter');

// 註冊預設的 Printers
printerManager.registerPrinter(new MapartPrinter());
printerManager.registerPrinter(new BuildingPrinter());
printerManager.registerPrinter(new RedstonePrinter());

module.exports = printerManager;

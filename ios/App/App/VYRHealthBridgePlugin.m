#import <Foundation/Foundation.h>

#import <Capacitor/Capacitor.h>

CAP_PLUGIN(VYRHealthBridge, "VYRHealthBridge",

    CAP_PLUGIN_METHOD(isHealthKitAvailable, CAPPluginReturnPromise);

    CAP_PLUGIN_METHOD(writeBodyTemperature, CAPPluginReturnPromise);

    CAP_PLUGIN_METHOD(writeBloodPressure, CAPPluginReturnPromise);

    CAP_PLUGIN_METHOD(writeVO2Max, CAPPluginReturnPromise);

    CAP_PLUGIN_METHOD(writeActiveEnergyBurned, CAPPluginReturnPromise);

    CAP_PLUGIN_METHOD(getAuthorizationStatuses, CAPPluginReturnPromise);

    CAP_PLUGIN_METHOD(enableBackgroundDelivery, CAPPluginReturnPromise);

    CAP_PLUGIN_METHOD(registerObserverQueries, CAPPluginReturnPromise);

    CAP_PLUGIN_METHOD(readAnchored, CAPPluginReturnPromise);

)

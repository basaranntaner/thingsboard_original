///
/// Copyright © 2016-2019 The Thingsboard Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///

import {
  EntityInfo,
  IWidgetSubscription,
  WidgetSubscriptionCallbacks,
  WidgetSubscriptionContext,
  WidgetSubscriptionOptions
} from '@core/api/widget-api.models';
import {
  DataSet,
  DataSetHolder,
  Datasource,
  DatasourceData,
  DatasourceType,
  LegendConfig,
  LegendData,
  LegendKey,
  LegendKeyData,
  widgetType
} from '@app/shared/models/widget.models';
import { HttpErrorResponse } from '@angular/common/http';
import {
  createSubscriptionTimewindow,
  SubscriptionTimewindow,
  Timewindow,
  toHistoryTimewindow,
  WidgetTimewindow
} from '@app/shared/models/time/time.models';
import { Observable, of, ReplaySubject, Subject } from 'rxjs';
import { CancelAnimationFrame } from '@core/services/raf.service';
import { EntityType } from '@shared/models/entity-type.models';
import { AlarmInfo, AlarmSearchStatus } from '@shared/models/alarm.models';
import { deepClone, isDefined } from '@core/utils';
import { AlarmSourceListener } from '@core/http/alarm.service';
import { DatasourceListener } from '@core/api/datasource.service';
import * as deepEqual from 'deep-equal';

export class WidgetSubscription implements IWidgetSubscription {

  id: string;
  ctx: WidgetSubscriptionContext;
  type: widgetType;
  callbacks: WidgetSubscriptionCallbacks;

  timeWindow: WidgetTimewindow;
  originalTimewindow: Timewindow;
  timeWindowConfig: Timewindow;
  subscriptionTimewindow: SubscriptionTimewindow;
  useDashboardTimewindow: boolean;

  data: Array<DatasourceData>;
  datasources: Array<Datasource>;
  datasourceListeners: Array<DatasourceListener>;
  hiddenData: Array<DataSetHolder>;
  legendData: LegendData;
  legendConfig: LegendConfig;
  caulculateLegendData: boolean;
  displayLegend: boolean;
  stateData: boolean;
  decimals: number;
  units: string;

  alarms: Array<AlarmInfo>;
  alarmSource: Datasource;
  alarmSearchStatus: AlarmSearchStatus;
  alarmsPollingInterval: number;
  alarmSourceListener: AlarmSourceListener;

  loadingData: boolean;

  targetDeviceAliasIds?: Array<string>;
  targetDeviceIds?: Array<string>;

  executingRpcRequest: boolean;
  rpcEnabled: boolean;
  rpcErrorText: string;
  rpcRejection: HttpErrorResponse;

  init$: Observable<IWidgetSubscription>;

  cafs: {[cafId: string]: CancelAnimationFrame} = {};

  targetDeviceAliasId: string;
  targetDeviceId: string;
  targetDeviceName: string;
  executingSubjects: Array<Subject<any>>;

  constructor(subscriptionContext: WidgetSubscriptionContext, options: WidgetSubscriptionOptions) {
    const subscriptionSubject = new ReplaySubject<IWidgetSubscription>();
    this.init$ = subscriptionSubject.asObservable();
    this.ctx = subscriptionContext;
    this.type = options.type;
    this.id = this.ctx.utils.guid();
    this.callbacks = options.callbacks;

    if (this.type === widgetType.rpc) {
      this.callbacks.rpcStateChanged = this.callbacks.rpcStateChanged || (() => {});
      this.callbacks.onRpcSuccess = this.callbacks.onRpcSuccess || (() => {});
      this.callbacks.onRpcFailed = this.callbacks.onRpcFailed || (() => {});
      this.callbacks.onRpcErrorCleared = this.callbacks.onRpcErrorCleared || (() => {});

      this.targetDeviceAliasIds = options.targetDeviceAliasIds;
      this.targetDeviceIds = options.targetDeviceIds;

      this.targetDeviceAliasId = null;
      this.targetDeviceId = null;

      this.rpcRejection = null;
      this.rpcErrorText = null;
      this.rpcEnabled = false;
      this.executingRpcRequest = false;
      this.executingSubjects = [];
      this.initRpc().subscribe(() => {
        subscriptionSubject.next(this);
        subscriptionSubject.complete();
      });
    } else if (this.type === widgetType.alarm) {
      this.callbacks.onDataUpdated = this.callbacks.onDataUpdated || (() => {});
      this.callbacks.onDataUpdateError = this.callbacks.onDataUpdateError || (() => {});
      this.callbacks.dataLoading = this.callbacks.dataLoading || (() => {});
      this.callbacks.timeWindowUpdated = this.callbacks.timeWindowUpdated || (() => {});
      this.alarmSource = options.alarmSource;
      this.alarmSearchStatus = isDefined(options.alarmSearchStatus) ?
        options.alarmSearchStatus : AlarmSearchStatus.ANY;
      this.alarmsPollingInterval = isDefined(options.alarmsPollingInterval) ?
        options.alarmsPollingInterval : 5000;
      this.alarmSourceListener = null;
      this.alarms = [];
      this.originalTimewindow = null;
      this.timeWindow = {};
      this.useDashboardTimewindow = options.useDashboardTimewindow;
      if (this.useDashboardTimewindow) {
        this.timeWindowConfig = deepClone(options.dashboardTimewindow);
      } else {
        this.timeWindowConfig = deepClone(options.timeWindowConfig);
      }
      this.subscriptionTimewindow = null;
      this.loadingData = false;
      this.displayLegend = false;
      this.initAlarmSubscription().subscribe(() => {
        subscriptionSubject.next(this);
        subscriptionSubject.complete();
      },
      () => {
        subscriptionSubject.error(null);
      });
    } else {
      this.callbacks.onDataUpdated = this.callbacks.onDataUpdated || (() => {});
      this.callbacks.onDataUpdateError = this.callbacks.onDataUpdateError || (() => {});
      this.callbacks.dataLoading = this.callbacks.dataLoading || (() => {});
      this.callbacks.legendDataUpdated = this.callbacks.legendDataUpdated || (() => {});
      this.callbacks.timeWindowUpdated = this.callbacks.timeWindowUpdated || (() => {});

      this.datasources = this.ctx.utils.validateDatasources(options.datasources);
      this.datasourceListeners = [];
      this.data = [];
      this.hiddenData = [];
      this.originalTimewindow = null;
      this.timeWindow = {};
      this.useDashboardTimewindow = options.useDashboardTimewindow;
      this.stateData = options.stateData;
      if (this.useDashboardTimewindow) {
        this.timeWindowConfig = deepClone(options.dashboardTimewindow);
      } else {
        this.timeWindowConfig = deepClone(options.timeWindowConfig);
      }

      this.subscriptionTimewindow = null;

      this.units = options.units || '';
      this.decimals = isDefined(options.decimals) ? options.decimals : 2;

      this.loadingData = false;

      if (options.legendConfig) {
        this.legendConfig = options.legendConfig;
        this.legendData = {
          keys: [],
          data: []
        };
        this.displayLegend = true;
      } else {
        this.displayLegend = false;
      }
      this.caulculateLegendData = this.displayLegend &&
        this.type === widgetType.timeseries &&
        (this.legendConfig.showMin === true ||
          this.legendConfig.showMax === true ||
          this.legendConfig.showAvg === true ||
          this.legendConfig.showTotal === true);
      this.initDataSubscription().subscribe(() => {
          subscriptionSubject.next(this);
          subscriptionSubject.complete();
        },
        () => {
          subscriptionSubject.error(null);
        });
    }
 }

  private initRpc(): Observable<any> {
    const initRpcSubject = new ReplaySubject();
    if (this.targetDeviceAliasIds && this.targetDeviceAliasIds.length > 0) {
      this.targetDeviceAliasId = this.targetDeviceAliasIds[0];
      this.ctx.aliasController.getAliasInfo(this.targetDeviceAliasId).subscribe(
        (aliasInfo) => {
          if (aliasInfo.currentEntity && aliasInfo.currentEntity.entityType === EntityType.DEVICE) {
            this.targetDeviceId = aliasInfo.currentEntity.id;
            this.targetDeviceName = aliasInfo.currentEntity.name;
            if (this.targetDeviceId) {
              this.rpcEnabled = true;
            } else {
              this.rpcEnabled = this.ctx.utils.widgetEditMode ? true : false;
            }
            this.callbacks.rpcStateChanged(this);
            initRpcSubject.next();
            initRpcSubject.complete();
          } else {
            this.rpcEnabled = false;
            this.callbacks.rpcStateChanged(this);
            initRpcSubject.next();
            initRpcSubject.complete();
          }
        },
        () => {
          this.rpcEnabled = false;
          this.callbacks.rpcStateChanged(this);
          initRpcSubject.next();
          initRpcSubject.complete();
        }
      );
    } else {
      if (this.targetDeviceIds && this.targetDeviceIds.length > 0) {
        this.targetDeviceId = this.targetDeviceIds[0];
      }
      if (this.targetDeviceId) {
        this.rpcEnabled = true;
      } else {
        this.rpcEnabled = this.ctx.utils.widgetEditMode ? true : false;
      }
      this.callbacks.rpcStateChanged(this);
      initRpcSubject.next();
      initRpcSubject.complete();
    }
    return initRpcSubject.asObservable();
  }

  private initAlarmSubscription(): Observable<any> {
    // TODO:
    return of(null);
  }

  private initDataSubscription(): Observable<any> {
    const initDataSubscriptionSubject = new ReplaySubject(1);
    this.loadStDiff().subscribe(() => {
      if (!this.ctx.aliasController) {
        this.configureData();
        initDataSubscriptionSubject.next();
        initDataSubscriptionSubject.complete();
      } else {
        this.ctx.aliasController.resolveDatasources(this.datasources).subscribe(
          (datasources) => {
            this.datasources = datasources;
            this.configureData();
            initDataSubscriptionSubject.next();
            initDataSubscriptionSubject.complete();
          },
          () => {
            initDataSubscriptionSubject.error(null);
          }
        );
      }
    });
    return initDataSubscriptionSubject.asObservable();
  }

  private configureData() {
    let dataIndex = 0;
    this.datasources.forEach((datasource) => {
      datasource.dataKeys.forEach((dataKey) => {
        dataKey.hidden = false;
        dataKey.pattern = dataKey.label;
        const datasourceData: DatasourceData = {
          datasource,
          dataKey,
          data: []
        };
        this.data.push(datasourceData);
        this.hiddenData.push({data: []});
        if (this.displayLegend) {
          const legendKey: LegendKey = {
            dataKey,
            dataIndex: dataIndex++
          };
          this.legendData.keys.push(legendKey);
          const legendKeyData: LegendKeyData = {
            min: null,
            max: null,
            avg: null,
            total: null,
            hidden: false
          };
          this.legendData.data.push(legendKeyData);
        }
      });
    });
    if (this.displayLegend) {
      this.legendData.keys = this.legendData.keys.sort((key1, key2) => key1.dataKey.label.localeCompare(key2.dataKey.label));
      // TODO:
    }
    if (this.type === widgetType.timeseries) {
      if (this.useDashboardTimewindow) {
        // TODO:
      } else {
        // TODO:
      }
    }
  }

  private resetData() {
    for (let i = 0; i < this.data.length; i++) {
      this.data[i].data = [];
      this.hiddenData[i].data = [];
      if (this.displayLegend) {
        this.legendData.data[i].min = null;
        this.legendData.data[i].max = null;
        this.legendData.data[i].avg = null;
        this.legendData.data[i].total = null;
        this.legendData.data[i].hidden = false;
      }
    }
    this.onDataUpdated();
  }

  getFirstEntityInfo(): EntityInfo {
    return undefined;
  }

  onAliasesChanged(aliasIds: Array<string>): boolean {
    return false;
  }

  private onDataUpdated(detectChanges?: boolean) {
    if (this.cafs.dataUpdated) {
      this.cafs.dataUpdated();
      this.cafs.dataUpdated = null;
    }
    this.cafs.dataUpdated = this.ctx.raf.raf(() => {
      try {
        this.callbacks.onDataUpdated(this, detectChanges);
      } catch (e) {
        this.callbacks.onDataUpdateError(this, e);
      }
    });
  }

  onDashboardTimewindowChanged(newDashboardTimewindow: Timewindow): void {
    if (this.type === widgetType.timeseries || this.type === widgetType.alarm) {
      if (this.useDashboardTimewindow) {
        if (!deepEqual(this.timeWindowConfig, newDashboardTimewindow) && newDashboardTimewindow) {
          this.timeWindowConfig = deepClone(newDashboardTimewindow);
          this.update();
        }
      }
    }
  }

  updateDataVisibility(index: number): void {
    if (this.displayLegend) {
      const hidden = this.legendData.keys[index].dataKey.hidden;
      if (hidden) {
        this.hiddenData[index].data = this.data[index].data;
        this.data[index].data = [];
      } else {
        this.data[index].data = this.hiddenData[index].data;
        this.hiddenData[index].data = [];
      }
      this.onDataUpdated();
    }
  }

  updateTimewindowConfig(newTimewindow: Timewindow): void {
  }

  onResetTimewindow(): void {
    if (this.useDashboardTimewindow) {
      this.ctx.dashboardTimewindowApi.onResetTimewindow();
    } else {
      if (this.originalTimewindow) {
        this.timeWindowConfig = deepClone(this.originalTimewindow);
        this.originalTimewindow = null;
        this.callbacks.timeWindowUpdated(this, this.timeWindowConfig);
        this.update();
      }
    }
  }

  onUpdateTimewindow(startTimeMs: number, endTimeMs: number, interval?: number): void {
    if (this.useDashboardTimewindow) {
      this.ctx.dashboardTimewindowApi.onUpdateTimewindow(startTimeMs, endTimeMs);
    } else {
      if (!this.originalTimewindow) {
        this.originalTimewindow = deepClone(this.timeWindowConfig);
      }
      this.timeWindowConfig = toHistoryTimewindow(this.timeWindowConfig, startTimeMs, endTimeMs, interval, this.ctx.timeService);
      this.callbacks.timeWindowUpdated(this, this.timeWindowConfig);
      this.update();
    }
  }

  sendOneWayCommand(method: string, params?: any, timeout?: number): Observable<any> {
    return undefined;
  }

  sendTwoWayCommand(method: string, params?: any, timeout?: number): Observable<any> {
    return undefined;
  }

  clearRpcError(): void {
  }

  update() {
    this.unsubscribe();
    this.subscribe();
  }

  subscribe(): void {
    if (this.cafs.subscribe) {
      this.cafs.subscribe();
      this.cafs.subscribe = null;
    }
    this.cafs.subscribe = this.ctx.raf.raf(() => {
      this.doSubscribe();
    });
  }

  private doSubscribe() {
    if (this.type === widgetType.rpc) {
      return;
    }
    if (this.type === widgetType.alarm) {
      this.alarmsSubscribe();
    } else {
      this.notifyDataLoading();
      if (this.type === widgetType.timeseries && this.timeWindowConfig) {
        this.updateRealtimeSubscription();
        if (this.subscriptionTimewindow.fixedWindow) {
          this.onDataUpdated();
        }
      }
      let index = 0;
      this.datasources.forEach((datasource) => {
        const listener: DatasourceListener = {
          subscriptionType: this.type,
          subscriptionTimewindow: this.subscriptionTimewindow,
          datasource,
          entityType: datasource.entityType,
          entityId: datasource.entityId,
          dataUpdated: this.dataUpdated.bind(this),
          updateRealtimeSubscription: () => {
            this.subscriptionTimewindow = this.updateRealtimeSubscription();
            return this.subscriptionTimewindow;
          },
          setRealtimeSubscription: (subscriptionTimewindow) => {
            this.updateRealtimeSubscription(deepClone(subscriptionTimewindow));
          },
          datasourceIndex: index
        };
        for (let a = 0; a < datasource.dataKeys.length; a++) {
          this.data[index + a].data = [];
        }
        index += datasource.dataKeys.length;
        this.datasourceListeners.push(listener);

        if (datasource.dataKeys.length) {
          this.ctx.datasourceService.subscribeToDatasource(listener);
        }
        let forceUpdate = false;
        if (datasource.unresolvedStateEntity ||
          !datasource.dataKeys.length ||
          (datasource.type === DatasourceType.entity && !datasource.entityId)
        ) {
          forceUpdate = true;
        }
        if (forceUpdate) {
          this.notifyDataLoaded();
          this.onDataUpdated();
        }
      });
    }
  }

  private alarmsSubscribe() {
    // TODO:
  }


  unsubscribe() {
    if (this.type !== widgetType.rpc) {
      if (this.type === widgetType.alarm) {
        this.alarmsUnsubscribe();
      } else {
        this.datasourceListeners.forEach((listener) => {
          this.ctx.datasourceService.unsubscribeFromDatasource(listener);
        });
        this.datasourceListeners.length = 0;
        this.resetData();
      }
    }
  }

  private alarmsUnsubscribe() {
    // TODO:
  }

  destroy(): void {
    this.unsubscribe();
    for (const cafId of Object.keys(this.cafs)) {
      if (this.cafs[cafId]) {
        this.cafs[cafId]();
        this.cafs[cafId] = null;
      }
    }
    // TODO:
  }

  private notifyDataLoading() {
    this.loadingData = true;
    this.callbacks.dataLoading(this);
  }

  private notifyDataLoaded() {
    this.loadingData = false;
    this.callbacks.dataLoading(this);
  }

  private updateTimewindow() {
    this.timeWindow.interval = this.subscriptionTimewindow.aggregation.interval || 1000;
    if (this.subscriptionTimewindow.realtimeWindowMs) {
      this.timeWindow.maxTime = Date.now() + this.timeWindow.stDiff;
      this.timeWindow.minTime = this.timeWindow.maxTime - this.subscriptionTimewindow.realtimeWindowMs;
    } else if (this.subscriptionTimewindow.fixedWindow) {
      this.timeWindow.maxTime = this.subscriptionTimewindow.fixedWindow.endTimeMs;
      this.timeWindow.minTime = this.subscriptionTimewindow.fixedWindow.startTimeMs;
    }
  }

  private updateRealtimeSubscription(subscriptionTimewindow?: SubscriptionTimewindow) {
    if (subscriptionTimewindow) {
      this.subscriptionTimewindow = subscriptionTimewindow;
    } else {
      this.subscriptionTimewindow =
        createSubscriptionTimewindow(this.timeWindowConfig, this.timeWindow.stDiff,
          this.stateData, this.ctx.timeService);
    }
    this.updateTimewindow();
    return this.subscriptionTimewindow;
  }

  private dataUpdated(sourceData: DataSetHolder, datasourceIndex: number, dataKeyIndex: number, detectChanges: boolean) {
    for (let x = 0; x < this.datasourceListeners.length; x++) {
      this.datasources[x].dataReceived = this.datasources[x].dataReceived === true;
      if (this.datasourceListeners[x].datasourceIndex === datasourceIndex && sourceData.data.length > 0) {
        this.datasources[x].dataReceived = true;
      }
    }
    this.notifyDataLoaded();
    let update = true;
    let currentData: DataSetHolder;
    if (this.displayLegend && this.legendData.keys[datasourceIndex + dataKeyIndex].dataKey.hidden) {
      currentData = this.hiddenData[datasourceIndex + dataKeyIndex];
    } else {
      currentData = this.data[datasourceIndex + dataKeyIndex];
    }
    if (this.type === widgetType.latest) {
      const prevData = currentData.data;
      if (!sourceData.data.length) {
        update = false;
      } else if (prevData && prevData[0] && prevData[0].length > 1 && sourceData.data.length > 0) {
        const prevTs = prevData[0][0];
        const prevValue = prevData[0][1];
        if (prevTs === sourceData.data[0][0] && prevValue === sourceData.data[0][1]) {
          update = false;
        }
      }
    }
    if (update) {
      if (this.subscriptionTimewindow && this.subscriptionTimewindow.realtimeWindowMs) {
        this.updateTimewindow();
      }
      currentData.data = sourceData.data;
      if (this.caulculateLegendData) {
        this.updateLegend(datasourceIndex + dataKeyIndex, sourceData.data, detectChanges);
      }
      this.onDataUpdated(detectChanges);
    }
  }

  private updateLegend(dataIndex: number, data: DataSet, detectChanges: boolean) {
    const dataKey = this.legendData.keys[dataIndex].dataKey;
    const decimals = isDefined(dataKey.decimals) ? dataKey.decimals : this.decimals;
    const units = dataKey.units && dataKey.units.length ? dataKey.units : this.units;
    const legendKeyData = this.legendData.data[dataIndex];
    if (this.legendConfig.showMin) {
      legendKeyData.min = this.ctx.widgetUtils.formatValue(calculateMin(data), decimals, units);
    }
    if (this.legendConfig.showMax) {
      legendKeyData.max = this.ctx.widgetUtils.formatValue(calculateMax(data), decimals, units);
    }
    if (this.legendConfig.showAvg) {
      legendKeyData.avg = this.ctx.widgetUtils.formatValue(calculateAvg(data), decimals, units);
    }
    if (this.legendConfig.showTotal) {
      legendKeyData.total = this.ctx.widgetUtils.formatValue(calculateTotal(data), decimals, units);
    }
    this.callbacks.legendDataUpdated(this, detectChanges !== false);
  }


  private loadStDiff(): Observable<any> {
    const loadSubject = new ReplaySubject(1);
    if (this.ctx.getServerTimeDiff && this.timeWindow) {
      this.ctx.getServerTimeDiff().subscribe(
        (stDiff) => {
          this.timeWindow.stDiff = stDiff;
          loadSubject.next();
          loadSubject.complete();
        },
        () => {
          this.timeWindow.stDiff = 0;
          loadSubject.next();
          loadSubject.complete();
        }
      );
    } else {
      if (this.timeWindow) {
        this.timeWindow.stDiff = 0;
      }
      loadSubject.next();
      loadSubject.complete();
    }
    return loadSubject.asObservable();
  }
}

function calculateMin(data: DataSet): number {
  if (data.length > 0) {
    let result = Number(data[0][1]);
    for (let i = 1; i < data.length; i++) {
      result = Math.min(result, Number(data[i][1]));
    }
    return result;
  } else {
    return null;
  }
}

function calculateMax(data: DataSet): number {
  if (data.length > 0) {
    let result = Number(data[0][1]);
    for (let i = 1; i < data.length; i++) {
      result = Math.max(result, Number(data[i][1]));
    }
    return result;
  } else {
    return null;
  }
}

function calculateAvg(data: DataSet): number {
  if (data.length > 0) {
    return calculateTotal(data) / data.length;
  } else {
    return null;
  }
}

function calculateTotal(data: DataSet): number {
  if (data.length > 0) {
    let result = 0;
    data.forEach((dataRow) => {
      result += Number(dataRow[1]);
    });
    return result;
  } else {
    return null;
  }
}
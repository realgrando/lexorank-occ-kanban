/**
 * NestJS Dynamic Module for LexoRank OCC Kanban
 */

import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { IBoardStorageDriver } from '../../interfaces';
import { KanbanOccService } from './kanban.service';
import { KANBAN_STORAGE_TOKEN } from './tokens';

export interface KanbanModuleOptions {
  storageDriver: IBoardStorageDriver;
}

export interface KanbanAsyncModuleOptions {
  useFactory: (
    ...args: any[]
  ) => Promise<KanbanModuleOptions> | KanbanModuleOptions;
  inject?: any[];
}

@Global()
@Module({})
export class KanbanOccModule {
  public static forRoot(options: KanbanModuleOptions): DynamicModule {
    const providers: Provider[] = [
      {
        provide: KANBAN_STORAGE_TOKEN,
        useValue: options.storageDriver,
      },
      KanbanOccService,
    ];

    return {
      module: KanbanOccModule,
      providers,
      exports: [KanbanOccService, KANBAN_STORAGE_TOKEN],
    };
  }

  public static forRootAsync(options: KanbanAsyncModuleOptions): DynamicModule {
    const asyncOptionsProvider: Provider = {
      provide: 'KANBAN_ASYNC_OPTIONS',
      useFactory: options.useFactory,
      inject: options.inject || [],
    };

    const storageProvider: Provider = {
      provide: KANBAN_STORAGE_TOKEN,
      useFactory: (opts: KanbanModuleOptions) => opts.storageDriver,
      inject: ['KANBAN_ASYNC_OPTIONS'],
    };

    return {
      module: KanbanOccModule,
      imports: [],
      providers: [asyncOptionsProvider, storageProvider, KanbanOccService],
      exports: [KanbanOccService, KANBAN_STORAGE_TOKEN],
    };
  }
}

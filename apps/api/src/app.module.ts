import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AccessModule } from './access/access.service';
import { AssistantController } from './assistant/assistant.controller';
import { AssistantService } from './assistant/assistant.service';
import { HelpController } from './help/help.controller';
import { HelpService } from './help/help.service';
import { AuthController } from './auth/auth.controller';
import { AutomationController } from './automation/automation.controller';
import { AutomationService } from './automation/automation.service';
import { PlaceService } from './automation/place.service';
import { EnergyController } from './energy/energy.controller';
import { EnergyService } from './energy/energy.service';
import { RulesController } from './automation/rules.controller';
import { RulesService } from './automation/rules.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { AuditModule } from './common/audit.service';
import { Settings, SETTINGS } from './config';
import { DevicesService } from './hardware/devices.service';
import { HardwareController } from './hardware/hardware.controller';
import { ConnectionsService } from './hardware/connections.service';
import { GeoService } from './hardware/geo.service';
import { LogsService } from './hardware/logs.service';
import { NodesService } from './hardware/nodes.service';
import { HealthController } from './health/health.controller';
import { FirmwareController } from './firmware/firmware.controller';
import { FirmwareService } from './firmware/firmware.service';
import { MonitoringController } from './monitoring/monitoring.controller';
import { MonitoringService } from './monitoring/monitoring.service';
import { PushService } from './monitoring/push.service';
import { MqttModule } from './mqtt/mqtt.service';
import { PrismaModule } from './prisma/prisma.service';
import { HomeController } from './platform/home.controller';
import { PlatformController } from './platform/platform.controller';
import { PlatformService } from './platform/platform.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { RealtimeModule } from './realtime/realtime.service';
import { RoomsController } from './rooms/rooms.controller';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { PasswordsService } from './auth/passwords.service';
import { MailService } from './mail/mail.service';
import { OutagesService } from './monitoring/outages.service';
import { VisitsController } from './visits/visits.controller';
import { VisitsService } from './visits/visits.service';

/**
 * Composition root. Shared infrastructure (database, broker, live updates, access rules, audit)
 * comes from global modules; feature services and controllers are listed here.
 */
export function createAppModule(settings: Settings) {
  @Global()
  @Module({ providers: [{ provide: SETTINGS, useValue: settings }], exports: [SETTINGS] })
  class SettingsModule {}

  @Module({
    imports: [
      SettingsModule,
      PrismaModule,
      MqttModule,
      RealtimeModule,
      AccessModule,
      AuditModule,
      JwtModule.register({ global: true, secret: settings.jwtSecret }),
    ],
    controllers: [
      HealthController, AuthController, UsersController, RoomsController, HardwareController, AssistantController, AutomationController, RulesController, EnergyController, PlatformController, HomeController, MonitoringController, FirmwareController, VisitsController, HelpController,
    ],
    providers: [
      { provide: APP_GUARD, useClass: AuthGuard },
      AuthService, PasswordsService, MailService, OutagesService, UsersService, LogsService, GeoService, ConnectionsService, NodesService, DevicesService, AssistantService, RealtimeGateway, AutomationService, PlaceService, RulesService, EnergyService, PlatformService, MonitoringService, FirmwareService, PushService, VisitsService, HelpService,
    ],
  })
  class AppModule {}
  return AppModule;
}

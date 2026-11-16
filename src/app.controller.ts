import { Controller, Get, Header } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getRoot() {
    return { status: 'ok', message: 'EduLoan API Service' };
  }

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('.well-known/assetlinks.json')
  @Header('Content-Type', 'application/json')
  getAssetLinks() {
    return [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'in.vidyaloans.app',
          sha256_cert_fingerprints: [
            'F9:D2:91:02:82:13:81:6C:32:40:6A:E7:53:1C:4B:05:59:CB:C6:A3:95:79:61:D7:55:20:68:9E:19:D8:5A:B3',
          ],
        },
      },
    ];
  }
}

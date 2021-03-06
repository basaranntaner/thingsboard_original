/**
 * Copyright © 2016-2020 The Thingsboard Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.thingsboard.server.transport.lwm2m.bootstrap.secure;

import lombok.Builder;
import lombok.Data;
import org.eclipse.leshan.core.SecurityMode;

@Data
public class LwM2MServerBootstrap {

    @Builder.Default
    String clientPublicKeyOrId = "";
    @Builder.Default
    String clientSecretKey = "";
    @Builder.Default
    String serverPublicKey = "";
    @Builder.Default
    Integer clientHoldOffTime = 1;
    @Builder.Default
    Integer bootstrapServerAccountTimeout = 0;

    @Builder.Default
    String host = "0.0.0.0";
    @Builder.Default
    Integer port = 0;

    @Builder.Default
    String securityMode = SecurityMode.NO_SEC.name();

    @Builder.Default
    Integer serverId = 123;
    @Builder.Default
    boolean bootstrapServerIs = false;

}

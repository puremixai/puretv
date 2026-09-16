// React Hook for Play Page Synchronization
'use client';

import { useRouter } from 'next/navigation';
import { useCallback,useEffect, useRef } from 'react';

import { logger } from '@/lib/logger';

import { useWatchRoomContextSafe } from '@/components/WatchRoomProvider';

import type { PlayState } from '@/types/watch-room';

interface PlaySyncPlayer {
  currentTime: number;
  playing: boolean;
  video?: { readyState: number };
  play: () => Promise<unknown>;
  pause: () => void;
  on: (event: string, handler: () => void) => void;
  off: (event: string, handler: () => void) => void;
}

interface UsePlaySyncOptions {
  artPlayerRef: React.MutableRefObject<PlaySyncPlayer | null>;
  videoId: string;
  videoName: string;
  videoYear?: string;
  searchTitle?: string;
  currentEpisode?: number;
  currentSource: string;
  videoUrl: string;
  playerReady: boolean;  // 播放器是否就绪
}

export function usePlaySync({
  artPlayerRef,
  videoId,
  videoName,
  videoYear,
  searchTitle,
  currentEpisode,
  currentSource,
  videoUrl,
  playerReady,
}: UsePlaySyncOptions) {
  const router = useRouter();
  const watchRoom = useWatchRoomContextSafe();
  const lastSyncTimeRef = useRef(0); // 上次同步时间
  const isHandlingRemoteCommandRef = useRef(false); // 标记是否正在处理远程命令

  // 检查是否在房间内
  const isInRoom = !!(watchRoom && watchRoom.currentRoom);
  const isOwner = watchRoom?.isOwner || false;
  const currentRoom = watchRoom?.currentRoom;
  const socket = watchRoom?.socket;

  // 广播播放状态给房间内所有人（任何成员都可以触发同步）
  const broadcastPlayState = useCallback(() => {
    if (!socket || !watchRoom || !isInRoom) return;

    const player = artPlayerRef.current;
    if (!player) return;

    const state: PlayState = {
      type: 'play',
      url: videoUrl,
      currentTime: player.currentTime || 0,
      isPlaying: player.playing || false,
      videoId,
      videoName,
      videoYear,
      searchTitle,
      episode: currentEpisode,
      source: currentSource,
    };

    // 使用防抖，避免频繁发送
    const now = Date.now();
    if (now - lastSyncTimeRef.current < 1000) return;
    lastSyncTimeRef.current = now;

    watchRoom.updatePlayState(state);
  }, [socket, videoUrl, videoId, videoName, videoYear, searchTitle, currentEpisode, currentSource, watchRoom, artPlayerRef, isInRoom]);

  // 接收并同步其他成员的播放状态
  useEffect(() => {
    if (!socket || !currentRoom || !isInRoom) {
      logger.debug('[PlaySync] Skip setup:', { hasSocket: !!socket, hasRoom: !!currentRoom, isInRoom });
      return;
    }

    logger.debug('[PlaySync] Setting up event listeners');

    const handlePlayUpdate = (state: PlayState) => {
      logger.debug('[PlaySync] Received play:update event:', state);
      const player = artPlayerRef.current;

      if (!player) {
        logger.warn('[PlaySync] Player not ready for play:update');
        return;
      }

      logger.debug('[PlaySync] Processing play update - current state:', {
        playerPlaying: player.playing,
        statePlaying: state.isPlaying,
        playerTime: player.currentTime,
        stateTime: state.currentTime
      });

      // 标记正在处理远程命令
      isHandlingRemoteCommandRef.current = true;

      // play:update 只同步进度，不改变播放/暂停状态
      // 播放/暂停状态由 play:play 和 play:pause 命令控制
      const timeDiff = Math.abs(player.currentTime - state.currentTime);
      if (timeDiff > 2) {
        logger.debug('[PlaySync] Seeking to:', state.currentTime, '(diff:', timeDiff, 's)');
        player.currentTime = state.currentTime;
        // 延迟重置标记，确保 seeked 事件已处理完毕
        setTimeout(() => {
          isHandlingRemoteCommandRef.current = false;
          logger.debug('[PlaySync] Reset flag after seek');
        }, 500);
      } else {
        logger.debug('[PlaySync] Time diff is small, no seek needed');
        // 没有操作，立即重置标记
        isHandlingRemoteCommandRef.current = false;
      }
    };

    const handlePlayCommand = () => {
      logger.debug('[PlaySync] ========== Received play:play event ==========');
      logger.debug('[PlaySync] isHandlingRemoteCommandRef:', isHandlingRemoteCommandRef.current);
      const player = artPlayerRef.current;

      if (!player) {
        logger.warn('[PlaySync] Player not ready for play:play');
        return;
      }

      logger.debug('[PlaySync] Player state before play:', {
        playing: player.playing,
        currentTime: player.currentTime,
        readyState: player.video?.readyState,
      });

      // 标记正在处理远程命令
      isHandlingRemoteCommandRef.current = true;
      logger.debug('[PlaySync] Set flag to true');

      // 只有在暂停状态时才执行播放
      if (!player.playing) {
        logger.debug('[PlaySync] Executing play command - calling player.play()');
        player.play()
          .then(() => {
            logger.debug('[PlaySync] Play command completed successfully');
            logger.debug('[PlaySync] Player state after play:', {
              playing: player.playing,
              currentTime: player.currentTime,
            });
            // 等待播放器事件触发后再重置标记
            setTimeout(() => {
              isHandlingRemoteCommandRef.current = false;
              logger.debug('[PlaySync] Reset flag after play');
            }, 500);
          })
          .catch((err: unknown) => {
            logger.error('[PlaySync] Play error:', err);
            isHandlingRemoteCommandRef.current = false;
          });
      } else {
        logger.debug('[PlaySync] Player already playing, skipping');
        isHandlingRemoteCommandRef.current = false;
      }
      logger.debug('[PlaySync] ========== End play:play handling ==========');
    };

    const handlePauseCommand = () => {
      logger.debug('[PlaySync] ========== Received play:pause event ==========');
      logger.debug('[PlaySync] isHandlingRemoteCommandRef:', isHandlingRemoteCommandRef.current);
      const player = artPlayerRef.current;

      if (!player) {
        logger.warn('[PlaySync] Player not ready for play:pause');
        return;
      }

      logger.debug('[PlaySync] Player state before pause:', {
        playing: player.playing,
        currentTime: player.currentTime,
      });

      // 标记正在处理远程命令
      isHandlingRemoteCommandRef.current = true;
      logger.debug('[PlaySync] Set flag to true');

      // 只有在播放状态时才执行暂停
      if (player.playing) {
        logger.debug('[PlaySync] Executing pause command - calling player.pause()');
        player.pause();
        logger.debug('[PlaySync] Player state after pause:', {
          playing: player.playing,
          currentTime: player.currentTime,
        });
        // pause 是同步的，但还是延迟重置以确保事件处理完毕
        setTimeout(() => {
          isHandlingRemoteCommandRef.current = false;
          logger.debug('[PlaySync] Reset flag after pause');
        }, 500);
      } else {
        logger.debug('[PlaySync] Player already paused, skipping');
        isHandlingRemoteCommandRef.current = false;
      }
      logger.debug('[PlaySync] ========== End play:pause handling ==========');
    };

    const handleSeekCommand = (currentTime: number) => {
      logger.debug('[PlaySync] Received play:seek event:', currentTime);
      const player = artPlayerRef.current;

      if (!player) {
        logger.warn('[PlaySync] Player not ready for play:seek');
        return;
      }

      // 标记正在处理远程命令
      isHandlingRemoteCommandRef.current = true;

      logger.debug('[PlaySync] Executing seek command');
      player.currentTime = currentTime;

      // 延迟重置标记，确保 seeked 事件已处理完毕
      setTimeout(() => {
        isHandlingRemoteCommandRef.current = false;
        logger.debug('[PlaySync] Reset flag after seek command');
      }, 500);
    };

    const handleChangeCommand = (state: PlayState) => {
      logger.debug('[PlaySync] Received play:change event:', state);
      logger.debug('[PlaySync] Current isOwner:', isOwner);

      // 只有房员才处理视频切换命令
      if (isOwner) {
        logger.debug('[PlaySync] Skipping play:change - user is owner');
        return;
      }

      // 跟随切换视频
      // 构建完整的 URL 参数
      const params = new URLSearchParams({
        id: state.videoId,
        source: state.source,
        episode: String(state.episode || 1),
      });

      // 添加可选参数
      if (state.videoName) params.set('title', state.videoName);
      if (state.videoYear) params.set('year', state.videoYear);
      if (state.searchTitle) params.set('stitle', state.searchTitle);

      const url = `/play?${params.toString()}`;
      logger.debug('[PlaySync] Member redirecting to:', url);

      // 使用 router.push 进行导航,支持在同一页面更新参数
      router.push(url);
    };

    socket.on('play:update', handlePlayUpdate);
    socket.on('play:play', handlePlayCommand);
    socket.on('play:pause', handlePauseCommand);
    socket.on('play:seek', handleSeekCommand);
    socket.on('play:change', handleChangeCommand);

    logger.debug('[PlaySync] Event listeners registered');

    return () => {
      logger.debug('[PlaySync] Cleaning up event listeners');
      socket.off('play:update', handlePlayUpdate);
      socket.off('play:play', handlePlayCommand);
      socket.off('play:pause', handlePauseCommand);
      socket.off('play:seek', handleSeekCommand);
      socket.off('play:change', handleChangeCommand);
    };
  }, [artPlayerRef, currentRoom, isInRoom, isOwner, router, socket]);

  // 监听播放器事件并广播（所有成员都可以触发同步）
  useEffect(() => {
    if (!socket || !currentRoom || !isInRoom || !watchRoom) {
      logger.debug('[PlaySync] Skip player setup:', { hasSocket: !!socket, hasRoom: !!currentRoom, isInRoom, hasWatchRoom: !!watchRoom });
      return;
    }

    if (!playerReady) {
      logger.debug('[PlaySync] Player not ready yet, waiting...');
      return;
    }

    const player = artPlayerRef.current;
    if (!player) {
      logger.warn('[PlaySync] Player ref is null despite playerReady=true');
      return;
    }

    logger.debug('[PlaySync] Setting up player event listeners');

    const handlePlay = () => {
      // 如果正在处理远程命令，不要广播（避免循环）
      if (isHandlingRemoteCommandRef.current) {
        logger.debug('[PlaySync] Play event triggered by remote command, not broadcasting');
        return;
      }

      const player = artPlayerRef.current;
      if (!player) return;

      // 确认播放器确实在播放状态才广播
      if (player.playing) {
        logger.debug('[PlaySync] Play event detected, player is playing, broadcasting...');
        // 只发送 play 命令，不发送完整状态（避免重复）
        watchRoom.play();
      } else {
        logger.debug('[PlaySync] Play event detected but player is paused, not broadcasting');
      }
    };

    const handlePause = () => {
      // 如果正在处理远程命令，不要广播（避免循环）
      if (isHandlingRemoteCommandRef.current) {
        logger.debug('[PlaySync] Pause event triggered by remote command, not broadcasting');
        return;
      }

      const player = artPlayerRef.current;
      if (!player) return;

      // 确认播放器确实在暂停状态才广播
      if (!player.playing) {
        logger.debug('[PlaySync] Pause event detected, player is paused, broadcasting...');
        // 只发送 pause 命令，不发送完整状态（避免重复）
        watchRoom.pause();
      } else {
        logger.debug('[PlaySync] Pause event detected but player is playing, not broadcasting');
      }
    };

    const handleSeeked = () => {
      // 如果正在处理远程命令，不要广播（避免循环）
      if (isHandlingRemoteCommandRef.current) {
        logger.debug('[PlaySync] Seeked event triggered by remote command, not broadcasting');
        return;
      }

      const player = artPlayerRef.current;
      if (!player) return;

      logger.debug('[PlaySync] Seeked event detected, broadcasting time:', player.currentTime);
      watchRoom.seekPlayback(player.currentTime);
    };

    player.on('play', handlePlay);
    player.on('pause', handlePause);
    player.on('seeked', handleSeeked);

    // 定期同步播放进度（每5秒）
    const syncInterval = setInterval(() => {
      if (!player.playing) return; // 暂停时不同步

      logger.debug('[PlaySync] Periodic sync - broadcasting state');
      broadcastPlayState();
    }, 5000);

    logger.debug('[PlaySync] Player event listeners registered with periodic sync');

    return () => {
      logger.debug('[PlaySync] Cleaning up player event listeners');
      player.off('play', handlePlay);
      player.off('pause', handlePause);
      player.off('seeked', handleSeeked);
      clearInterval(syncInterval);
    };
  }, [socket, currentRoom, artPlayerRef, watchRoom, broadcastPlayState, isInRoom, playerReady]);

  // 使用ref跟踪上一次的值，用于检测真正的变化
  const lastBroadcastRef = useRef<{
    videoId: string;
    source: string;
    episode: number;
  } | null>(null);

  // 房主：监听视频/集数/源变化并广播
  useEffect(() => {
    if (!isOwner || !socket || !currentRoom || !isInRoom || !watchRoom) {
      // 如果不是房主或不在房间，重置跟踪
      lastBroadcastRef.current = null;
      return;
    }
    if (!videoId || !videoUrl) return;

    const currentState = {
      videoId,
      source: currentSource,
      episode: currentEpisode || 1,
    };

    // 检查是否需要广播
    const shouldBroadcast = !lastBroadcastRef.current ||
      lastBroadcastRef.current.videoId !== currentState.videoId ||
      lastBroadcastRef.current.source !== currentState.source ||
      lastBroadcastRef.current.episode !== currentState.episode;

    if (!shouldBroadcast) {
      logger.debug('[PlaySync] No change detected, skipping broadcast');
      return;
    }

    logger.debug('[PlaySync] Detected change, will broadcast:', {
      from: lastBroadcastRef.current,
      to: currentState
    });

    // 延迟广播，确保页面已经稳定
    const timer = setTimeout(() => {
      const state: PlayState = {
        type: 'play',
        url: videoUrl,
        currentTime: artPlayerRef.current?.currentTime || 0,
        isPlaying: artPlayerRef.current?.playing || false,
        videoId,
        videoName,
        videoYear,
        searchTitle,
        episode: currentEpisode,
        source: currentSource,
      };

      logger.debug('[PlaySync] Broadcasting play:change:', state);
      watchRoom.changeVideo(state);

      // 更新跟踪值
      lastBroadcastRef.current = currentState;
    }, 500); // 减少延迟到500ms

    return () => clearTimeout(timer);
  }, [isOwner, socket, currentRoom, isInRoom, watchRoom, videoId, currentEpisode, currentSource, videoUrl, videoName, videoYear, searchTitle, artPlayerRef]);

  // 房主：加入房间时立即广播当前播放状态
  const lastRoomStateRef = useRef<{ isOwner: boolean; roomId: string | null }>({ isOwner: false, roomId: null });

  useEffect(() => {
    const currentRoomId = currentRoom?.id || null;
    const prevRoomState = lastRoomStateRef.current;

    // 检测是否刚成为房主或刚加入房间
    const justBecameOwner = !prevRoomState.isOwner && isOwner;
    const justJoinedRoom = !prevRoomState.roomId && currentRoomId;

    // 更新ref
    lastRoomStateRef.current = { isOwner, roomId: currentRoomId };

    if (!isOwner || !socket || !currentRoom || !isInRoom || !watchRoom) return;
    if (!videoId || !videoUrl) return;
    if (!justBecameOwner && !justJoinedRoom) return;

    logger.debug('[PlaySync] Owner joined room, broadcasting current state immediately:', {
      justBecameOwner,
      justJoinedRoom
    });

    // 立即广播当前状态
    const state: PlayState = {
      type: 'play',
      url: videoUrl,
      currentTime: artPlayerRef.current?.currentTime || 0,
      isPlaying: artPlayerRef.current?.playing || false,
      videoId,
      videoName,
      videoYear,
      searchTitle,
      episode: currentEpisode,
      source: currentSource,
    };

    // 短暂延迟确保房间连接已稳定
    const timer = setTimeout(() => {
      logger.debug('[PlaySync] Broadcasting play:change on room join:', state);
      watchRoom.changeVideo(state);

      // 同时更新跟踪值，避免立即重复广播
      lastBroadcastRef.current = {
        videoId,
        source: currentSource,
        episode: currentEpisode || 1,
      };
    }, 300);

    return () => clearTimeout(timer);
  }, [isOwner, currentRoom, socket, isInRoom, watchRoom, videoId, videoUrl, videoName, videoYear, searchTitle, currentEpisode, currentSource, artPlayerRef]);

  return {
    isInRoom,
    isOwner,
    shouldDisableControls: isInRoom && !isOwner, // 房员禁用某些控制
    broadcastPlayState, // 导出供手动调用
  };
}

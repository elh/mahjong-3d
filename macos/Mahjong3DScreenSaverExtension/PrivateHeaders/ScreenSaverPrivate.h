//
//  ScreenSaverPrivate.h
//  Mahjong3DScreenSaverExtension
//
//  Private API declarations for modern macOS screen saver extensions.
//  Based on AerialScreensaver/AppexSaverMinimal, MIT licensed.
//

#import <AppKit/AppKit.h>
#import <ScreenSaver/ScreenSaver.h>

NS_ASSUME_NONNULL_BEGIN

@interface ScreenSaverExtension : NSObject

- (instancetype)init;

@end

@interface ScreenSaverViewController : NSViewController

@property (nonatomic, getter=isAnimating) BOOL animating;

- (void)loadViewForFrame:(NSRect)frame isPreview:(BOOL)isPreview NS_SWIFT_NAME(loadView(forFrame:isPreview:));

@end

@interface ScreenSaverConfigurationViewController : NSViewController
@end

NS_ASSUME_NONNULL_END
